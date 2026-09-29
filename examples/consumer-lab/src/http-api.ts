/**
 * The installed `askdb-http` bin (`@askdb/http-api`, reference/http-api.mdx, "Standalone
 * binary"), run the way the deploy guide runs it: `askdb-http --schema-path … --port …
 * --host 127.0.0.1`, from a project directory whose `askdb.config.ts` it reads.
 *
 * Every server binds 127.0.0.1 on a free port and is ready once the documented `GET
 * /health` answers. `close()` kills it; callers call it in `afterAll` or `finally`.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { LAB_ROOT } from "./paths.js";

export const ASKDB_HTTP_BIN = join(LAB_ROOT, "node_modules", ".bin", "askdb-http");

/** Provider keys a developer's shell may hold; a server must only see the config it's given. */
export const PROVIDER_KEYS = ["OPENAI_API_KEY", "AZURE_OPENAI_API_KEY", "AZURE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY"];

export interface HttpServerOptions {
  /** Project directory: where the server runs and finds `askdb.config.ts`. Default: the lab. */
  cwd?: string;
  /** `--schema-path`. */
  schemaPath?: string;
  /** Extra environment, e.g. `LAB_REPLAY_BASE_URL` for the lab's config. */
  env?: Record<string, string>;
  /** The bin to run. Default: the lab's installed `askdb-http`. */
  bin?: string;
}

export interface HttpServer {
  /** `http://127.0.0.1:<port>` */
  readonly url: string;
  /** Everything the process wrote to stdout and stderr so far. */
  output(): string;
  close(): Promise<void>;
}

/** A port nothing is listening on right now (the bin rejects `--port 0`). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** SIGTERM a server process, then SIGKILL it if it hasn't exited within 5 seconds. */
export function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const force = setTimeout(() => child.kill("SIGKILL"), 5_000);
    child.once("exit", () => {
      clearTimeout(force);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

/** Start `askdb-http` and wait until `GET /health` answers. Fails with the server's output if it exits first. */
export async function startHttpServer(options: HttpServerOptions = {}): Promise<HttpServer> {
  const bin = options.bin ?? ASKDB_HTTP_BIN;
  if (!existsSync(bin)) throw new Error(`${bin} is missing; reinstall the lab with \`pnpm lab:use <target>\``);
  const port = await freePort();
  const args = ["--port", String(port), "--host", "127.0.0.1"];
  if (options.schemaPath) args.push("--schema-path", options.schemaPath);

  const env: NodeJS.ProcessEnv = { ...process.env, ...options.env };
  for (const key of PROVIDER_KEYS) delete env[key];
  const child = spawn(bin, args, { cwd: options.cwd ?? LAB_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout!.on("data", (d) => (output += d));
  child.stderr!.on("data", (d) => (output += d));

  const url = `http://127.0.0.1:${port}`;
  const server: HttpServer = { url, output: () => output, close: () => stopProcess(child) };
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`askdb-http exited (${child.exitCode ?? child.signalCode}) before serving /health:\n${output}`);
    }
    try {
      if ((await fetch(`${url}/health`)).ok) return server;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  await server.close();
  throw new Error(`askdb-http didn't serve /health within 30s:\n${output}`);
}

export interface HttpReply {
  status: number;
  headers: Headers;
  /** The parsed JSON body. */
  body: Record<string, any>;
}

/** `POST /ask` with a raw body (a string is sent as-is, so malformed JSON can be sent). */
export async function postAsk(server: HttpServer, body: unknown, headers: Record<string, string> = {}): Promise<HttpReply> {
  const res = await fetch(`${server.url}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, body: (await res.json()) as Record<string, any> };
}
