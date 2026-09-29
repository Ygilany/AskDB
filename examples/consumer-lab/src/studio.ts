/**
 * Studio, run the way `reference/cli.mdx` and `studio.mdx` describe: the installed
 * `askdb studio --schema <artifact> --port <free port> --host 127.0.0.1`, from a project
 * directory whose `askdb.config.ts` it reads (`@askdb/studio` is one of the lab's direct
 * dependencies, as the CLI reference asks).
 *
 * Each server runs in its own project directory under `.lab/`, with a copy of the schema
 * artifact, so nothing Studio writes lands in the lab's cached artifacts. It is ready once
 * its page, `GET /`, answers 200. `close()` kills it and removes the project; callers call
 * it in `afterAll` or `finally`.
 *
 * Requests go through `node:http`, not `fetch`, so a test can send any `Host` and `Origin`
 * header, as a rebound or cross-site browser page would.
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { PROVIDER_KEYS, freePort, stopProcess } from "./http-api.js";
import { ASKDB_BIN } from "./introspect.js";
import { LAB_STATE } from "./paths.js";

/** The `<meta>` tag Studio's page carries the session token in (ADR 0009). */
const TOKEN_META = /<meta\s+name="askdb-studio-token"\s+content="([^"]*)"/;
/** The header every `/api/*` request must carry the token in (`studio.mdx`, "Security model"). */
export const TOKEN_HEADER = "x-askdb-studio-token";

/** A `studio.execute` block (`reference/config.mdx`, "Studio execute configuration"). */
export interface StudioExecute {
  provider: "postgres" | "mysql" | "sqlite" | "sqlserver";
  /** The owner connection string (network engines), passed through `env("LAB_STUDIO_EXECUTE_URL")`. */
  databaseUrl?: string;
  /** The SQLite file, passed through `env("LAB_STUDIO_EXECUTE_FILE")`. */
  file?: string;
}

export interface StudioOptions {
  /** The schema artifact to copy into the project and pass as `--schema`. */
  schema: string;
  /** `studio.execute`, with `enabled: true`. Without it the config has no `studio` block. */
  execute?: StudioExecute;
}

export interface StudioServer {
  readonly port: number;
  /** `127.0.0.1:<port>`, the `Host` a browser sends for the URL Studio serves. */
  readonly host: string;
  /** `http://127.0.0.1:<port>` */
  readonly origin: string;
  /** Everything the process wrote to stdout and stderr so far. */
  output(): string;
  close(): Promise<void>;
}

export interface StudioReply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
  /** The body, parsed as JSON; `undefined` when it isn't JSON. */
  json: any;
}

export interface StudioRequest {
  method?: string;
  path?: string;
  /** Sent as given; `host` defaults to the server's own. */
  headers?: Record<string, string>;
  body?: string;
}

/** Send one request to `server`. Headers are sent exactly as given (plus `host` and `content-length`). */
export function studioRequest(server: StudioServer, req: StudioRequest = {}): Promise<StudioReply> {
  const headers: Record<string, string> = { host: server.host, ...req.headers };
  if (req.body !== undefined) headers["content-length"] = String(Buffer.byteLength(req.body));
  return new Promise((resolve, reject) => {
    const r = request({ host: "127.0.0.1", port: server.port, method: req.method ?? "GET", path: req.path ?? "/", headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (text += d));
      res.on("end", () => {
        let json: any;
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
      });
    });
    r.on("error", reject);
    r.end(req.body);
  });
}

/** The session token in a served page, or `undefined` when the page has none. */
export function pageToken(html: string): string | undefined {
  return TOKEN_META.exec(html)?.[1];
}

/**
 * The project's `askdb.config.ts`. `ai`, `introspection` and `rag` are required top-level
 * fields (`reference/config.mdx`); the connection goes through `env()`, as the docs write it.
 */
function studioConfig(execute: StudioExecute | undefined): string {
  const connection = execute?.provider === "sqlite" ? `file: env("LAB_STUDIO_EXECUTE_FILE")` : `databaseUrl: env("LAB_STUDIO_EXECUTE_URL")`;
  const studio = execute ? `\n  studio: { execute: { enabled: true, provider: "${execute.provider}", ${connection} } },` : "";
  return `import { defineConfig, env } from "@askdb/config";

export default defineConfig({
  ai: { provider: "openai", providerConfig: { openai: { apiKey: "", model: "gpt-4o-mini" } } },
  introspection: { provider: "postgres", providerConfig: { postgres: {} } },
  rag: { embedder: "mock", embedderConfig: {}, store: "memory", storeConfig: { memory: {} } },${studio}
});
`;
}

/** Start `askdb studio` in a fresh project and wait until its page answers. Fails with Studio's output if it exits first. */
export async function startStudio(options: StudioOptions): Promise<StudioServer> {
  if (!existsSync(ASKDB_BIN)) throw new Error(`${ASKDB_BIN} is missing; reinstall the lab with \`pnpm lab:use <target>\``);
  mkdirSync(LAB_STATE, { recursive: true });
  // Inside the lab, so the config's `@askdb/config` import and Studio's drivers resolve from its node_modules.
  const project = mkdtempSync(join(LAB_STATE, "studio-"));
  const schema = join(project, "schema");
  cpSync(options.schema, schema, { recursive: true });
  writeFileSync(join(project, "askdb.config.ts"), studioConfig(options.execute));

  const port = await freePort();
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of PROVIDER_KEYS) delete env[key];
  if (options.execute?.databaseUrl) env.LAB_STUDIO_EXECUTE_URL = options.execute.databaseUrl;
  if (options.execute?.file) env.LAB_STUDIO_EXECUTE_FILE = options.execute.file;
  const child = spawn(ASKDB_BIN, ["studio", "--schema", schema, "--port", String(port), "--host", "127.0.0.1"], {
    cwd: project,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout!.on("data", (d) => (output += d));
  child.stderr!.on("data", (d) => (output += d));

  const server: StudioServer = {
    port,
    host: `127.0.0.1:${port}`,
    origin: `http://127.0.0.1:${port}`,
    output: () => output,
    close: async () => {
      await stopProcess(child);
      rmSync(project, { recursive: true, force: true });
    },
  };
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      rmSync(project, { recursive: true, force: true });
      throw new Error(`askdb studio exited (${child.exitCode ?? child.signalCode}) before serving its page:\n${output}`);
    }
    try {
      if ((await studioRequest(server)).status === 200) return server;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  await server.close();
  throw new Error(`askdb studio didn't serve its page within 30s:\n${output}`);
}
