/**
 * The installed `askdb-http` bin (`@askdb/http-api`, reference/http-api.mdx, "Standalone
 * binary"), run the way the deploy guide runs it: `askdb-http --schema-path … --port …
 * --host 127.0.0.1`, from a project directory whose `askdb.config.ts` it reads.
 *
 * Every server binds 127.0.0.1 on a free port and is ready once the documented `GET
 * /health` answers. `close()` kills it; callers call it in `afterAll` or `finally`.
 */
import { join } from "node:path";
import { LAB_ROOT } from "./paths.js";
import { startServerProcess } from "./server-process.js";

export const ASKDB_HTTP_BIN = join(LAB_ROOT, "node_modules", ".bin", "askdb-http");

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

/** Start `askdb-http` and wait until `GET /health` answers. Fails with the server's output if it exits first. */
export async function startHttpServer(options: HttpServerOptions = {}): Promise<HttpServer> {
  const server = await startServerProcess({
    name: "askdb-http",
    bin: options.bin ?? ASKDB_HTTP_BIN,
    args: (port) => ["--port", String(port), "--host", "127.0.0.1", ...(options.schemaPath ? ["--schema-path", options.schemaPath] : [])],
    cwd: options.cwd ?? LAB_ROOT,
    env: options.env,
    ready: async (port) => (await fetch(`http://127.0.0.1:${port}/health`)).ok,
    readyWhen: "GET /health",
  });
  return { url: `http://127.0.0.1:${server.port}`, output: server.output, close: server.close };
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
