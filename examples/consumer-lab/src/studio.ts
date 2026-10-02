/**
 * Studio, run the way `reference/cli.mdx` and `studio.mdx` describe: the installed
 * `askdb studio --schema <artifact> --port <free port> --host 127.0.0.1`, from a project
 * directory whose `askdb.config.ts` it reads (`@askdb/studio` is one of the lab's direct
 * dependencies, as the CLI reference asks).
 *
 * Each server runs in its own project directory under `.lab/`, with a copy of the schema
 * artifact, so nothing Studio writes lands in the lab's cached artifacts. It is ready once
 * its page, `GET /`, answers 200 (`src/server-process.ts` starts and stops it, as it does
 * `askdb-http`). `close()` kills it and removes the project; callers call it in `afterAll`
 * or `finally`.
 *
 * Requests go through `node:http`, not `fetch`, so a test can send any `Host` and `Origin`
 * header, as a rebound or cross-site browser page would.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { ASKDB_BIN } from "./introspect.js";
import { LAB_STATE } from "./paths.js";
import { startServerProcess } from "./server-process.js";

/** The `name` of the `<meta>` tag Studio's page carries the session token in (ADR 0009). */
const TOKEN_META_NAME = "askdb-studio-token";
const META_TAG = /<meta\b([^>]*)>/gi;
const ATTRIBUTE = /([^\s"'=<>/]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
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

export interface StudioAddress {
  readonly port: number;
  /** `127.0.0.1:<port>`, the `Host` a browser sends for the URL Studio serves. */
  readonly host: string;
  /** `http://127.0.0.1:<port>` */
  readonly origin: string;
}

export interface StudioServer extends StudioAddress {
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
export function studioRequest(server: StudioAddress, req: StudioRequest = {}): Promise<StudioReply> {
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
  // HTML attributes are unordered, and may be quoted either way or not at all.
  for (const [, attrs] of html.matchAll(META_TAG)) {
    const values = new Map<string, string>();
    for (const [, name, double, single, bare] of attrs!.matchAll(ATTRIBUTE)) {
      values.set(name!.toLowerCase(), double ?? single ?? bare ?? "");
    }
    if (values.get("name") === TOKEN_META_NAME && values.has("content")) return values.get("content");
  }
  return undefined;
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
  mkdirSync(LAB_STATE, { recursive: true });
  // Inside the lab, so the config's `@askdb/config` import and Studio's drivers resolve from its node_modules.
  const project = mkdtempSync(join(LAB_STATE, "studio-"));
  const schema = join(project, "schema");
  cpSync(options.schema, schema, { recursive: true });
  writeFileSync(join(project, "askdb.config.ts"), studioConfig(options.execute));

  const env: Record<string, string> = {};
  if (options.execute?.databaseUrl) env.LAB_STUDIO_EXECUTE_URL = options.execute.databaseUrl;
  if (options.execute?.file) env.LAB_STUDIO_EXECUTE_FILE = options.execute.file;
  const removeProject = () => rmSync(project, { recursive: true, force: true });
  const running = await startServerProcess({
    name: "askdb studio",
    bin: ASKDB_BIN,
    args: (port) => ["studio", "--schema", schema, "--port", String(port), "--host", "127.0.0.1"],
    cwd: project,
    env,
    ready: async (port) => (await studioRequest(loopback(port))).status === 200,
    readyWhen: "GET / (its page)",
  }).catch((error: unknown) => {
    removeProject();
    throw error;
  });
  return {
    ...loopback(running.port),
    output: running.output,
    close: async () => {
      await running.close();
      removeProject();
    },
  };
}

/** How a browser reaches a Studio on 127.0.0.1:`port`. */
function loopback(port: number): StudioAddress {
  return { port, host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` };
}
