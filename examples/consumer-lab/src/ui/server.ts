/**
 * `pnpm lab ui`: one page that runs an input (a catalog question, free text, or raw SQL) on
 * every engine at once, through `askAndRun` (`src/ask-run.ts`), the code path `lab ask`
 * prints. Each engine's column shows that transcript, so it reads exactly as
 * `pnpm lab ask --db <engine>` would for the same input.
 *
 *   GET  /          the page (`page.html`), naming the install target and model mode
 *   POST /api/run   `{ question, sql? }` → NDJSON: one `engine` event per engine as it
 *                   finishes, then one `summary` event (`summary.ts`)
 *
 * The model is always the raw path (`createOpenAI({ baseURL })` → `ask()`): `--via client`
 * reads `askdb.config.ts` once per process, which pins the first engine's replay URL.
 *
 * The install is the one `lab:use` recorded when the server started, whose modules the
 * process loaded. If `lab:use` reinstalls while the server runs (another target, or the
 * same label at other versions), or is part-way through, the page and the API answer `409`
 * until the server is restarted, rather than name one install and test another.
 *
 * Local-server protection, following ADR 0009's lesson for Studio: the server binds
 * 127.0.0.1 only, and every request's `Host` must be `127.0.0.1:<port>` or
 * `localhost:<port>` (`403` otherwise), which defeats DNS rebinding. `POST /api/run` also
 * needs `Content-Type: application/json` (`415`), which forces a CORS preflight the server
 * never answers, and a same-origin `Origin` when one is sent (`403`). It has no session
 * token: the page reads nothing secret, and the SQL runs as the fixture's read-only role.
 */
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { askAndRun, type AskInput, type AskRun, type AskRunStatus, type TranscriptLine } from "../ask-run.js";
import { installRecord, requireInstallTarget } from "../artifacts.js";
import { SUPPORTED_DIALECTS, type SupportedDialect } from "../dialects.js";
import type { ExecuteResult } from "../host/execute.js";
import { loadQuestions } from "../model/catalog.js";
import { summarize } from "./summary.js";

/** The model `lab ui` asks: the replay server. A live model is #247. */
export const MODEL_MODE = "replay";

const PAGE = new URL("./page.html", import.meta.url);
const BODY_LIMIT = 64 * 1024;

export interface LabUiOptions {
  /** Default 0: any free port. */
  port?: number;
  /** An engine with no result after this long is reported as timed out. Default 60 s. */
  engineTimeoutMs?: number;
}

export interface LabUi {
  /** `http://127.0.0.1:<port>` */
  readonly url: string;
  close(): Promise<void>;
}

/** What `POST /api/run` takes: `lab ask`'s input, always on the raw model path. */
export type UiInput = Omit<AskInput, "via">;

export type EngineStatus = AskRunStatus | "timeout";

/** One engine's column, as `POST /api/run` sends it. */
export interface EngineEvent {
  type: "engine";
  dialect: SupportedDialect;
  status: EngineStatus;
  /** `lab ask`'s exit code; absent when it would have thrown (`failed`, `timeout`). */
  exitCode?: AskRun["exitCode"];
  /** What `lab ask --db <dialect>` prints for the input, in order. */
  lines: TranscriptLine[];
  /** For `failed` and `timeout`: what went wrong. */
  error?: string;
  rowCount?: number;
  truncated?: boolean;
  timings: AskRun["timings"];
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * Run the input on one engine, giving up after `timeoutMs`. A timed-out run can't be
 * cancelled (no driver call here takes a signal): it ends on its own, or with the process.
 * `signal`, aborted when the server closes, kills its introspection.
 * Returns the engine's event, and the rows it read, which the summary needs and the page doesn't.
 */
async function runEngine(
  dialect: SupportedDialect,
  input: UiInput,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<{ event: EngineEvent; rows?: ExecuteResult }> {
  const started = performance.now();
  const lines: TranscriptLine[] = [];
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<"timeout">((resolve) => (timer = setTimeout(() => resolve("timeout"), timeoutMs)));
  try {
    const run = await Promise.race([askAndRun(dialect, input, { onLine: (line) => lines.push(line), signal }), deadline]);
    const event: EngineEvent =
      run === "timeout"
        ? { type: "engine", dialect, status: "timeout", lines: [...lines], error: `no result after ${timeoutMs} ms`, timings: { totalMs: performance.now() - started } }
        : {
            type: "engine",
            dialect,
            status: run.status,
            exitCode: run.exitCode,
            lines: run.lines,
            error: run.status === "failed" ? describeError(run.error) : undefined,
            rowCount: run.rows?.rows.length,
            truncated: run.rows?.truncated,
            timings: run.timings,
          };
    return { event, rows: run === "timeout" ? undefined : run.rows };
  } finally {
    clearTimeout(timer);
  }
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(target: string): string {
  // `<` escaped, so no value can close the <script> element the JSON sits in.
  const data = JSON.stringify({ dialects: SUPPORTED_DIALECTS, questions: loadQuestions() }).replace(/</g, "\\u003c");
  return readFileSync(PAGE, "utf8")
    .replace("<!--TARGET-->", () => escapeHtml(target))
    .replace("<!--MODEL_MODE-->", () => escapeHtml(MODEL_MODE))
    .replace("/*LAB_DATA*/null", () => data);
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<string | undefined> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > BODY_LIMIT) return undefined;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseInput(body: string): UiInput | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const { question = "", sql } = value as Record<string, unknown>;
  if (typeof question !== "string" || (sql !== undefined && typeof sql !== "string")) return undefined;
  // SQL that was sent is what runs: blank SQL is refused, never replaced by its question.
  if (sql !== undefined) return sql.trim() ? { question: question.trim(), sql } : undefined;
  return question.trim() ? { question: question.trim() } : undefined;
}

export async function startLabUi(options: LabUiOptions = {}): Promise<LabUi> {
  const engineTimeoutMs = options.engineTimeoutMs ?? 60_000;
  const target = requireInstallTarget().label;
  const installed = installRecord();
  // Aborted on close: kills every run's child processes.
  const closing = new AbortController();
  let port = 0;
  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const allowedOrigins = () => new Set([...allowedHosts()].map((h) => `http://${h}`));

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Every request, the page included: a rebound page must not even read the page.
    if (!allowedHosts().has(req.headers.host ?? "")) return sendText(res, 403, "lab ui: refused: foreign Host header");
    if (installRecord() !== installed) {
      return sendText(res, 409, `lab ui: lab:use changed the install after this server started on "${target}" (or is installing now); restart pnpm lab ui.`);
    }
    const path = (req.url ?? "/").split("?")[0];

    if (req.method === "GET" && path === "/") {
      const html = page(target);
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-frame-options": "DENY",
        "content-security-policy": "frame-ancestors 'none'",
      });
      return void res.end(html);
    }

    if (req.method === "POST" && path === "/api/run") {
      const origin = req.headers.origin;
      if (origin !== undefined && !allowedOrigins().has(origin)) return sendText(res, 403, "lab ui: refused: cross-site Origin");
      if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) return sendText(res, 415, "lab ui: POST /api/run needs Content-Type: application/json");
      const body = await readBody(req);
      if (body === undefined) return sendText(res, 413, "lab ui: request body too large");
      const input = parseInput(body);
      if (!input) return sendText(res, 400, 'lab ui: send { "question": string, "sql"?: string } with a question, or with SQL that isn\'t blank');

      res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" });
      // Engines run concurrently; each column is sent as soon as its engine finishes.
      const runs = await Promise.all(
        SUPPORTED_DIALECTS.map(async (dialect) => {
          const run = await runEngine(dialect, input, engineTimeoutMs, closing.signal);
          res.write(`${JSON.stringify(run.event)}\n`);
          return run;
        }),
      );
      // Raw SQL is compared through the catalog question it's labelled with, if any.
      const summary = summarize(input.question, runs.map(({ event, rows }) => ({ dialect: event.dialect, status: event.status, rows })));
      return void res.end(`${JSON.stringify({ type: "summary", summary })}\n`);
    }

    sendText(res, 404, `lab ui: no route for ${req.method} ${path}`);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      // A lab bug or an aborted request: answer it if we still can, and keep serving.
      const message = `lab ui: ${describeError(error)}`;
      if (!res.headersSent) sendText(res, 500, message);
      else res.end(`${JSON.stringify({ type: "error", error: message })}\n`);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    // Loopback only, never a wildcard bind.
    server.listen(options.port ?? 0, "127.0.0.1", resolve);
  });
  port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        closing.abort();
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
