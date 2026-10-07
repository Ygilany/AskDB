/**
 * `pnpm lab ui`: one page that runs an input (a catalog question, free text, or raw SQL) on
 * the engines you pick at once, through `askAndRun` (`src/ask-run.ts`), the code path
 * `lab ask` prints. Each engine's column shows that transcript, so it reads exactly as
 * `pnpm lab ask --db <engine>` would for the same input, model and path.
 *
 *   GET  /          the page (`page.html`), naming the install target and the live model
 *   POST /api/run   `{ question, sql?, via?, model?, engines? }` → NDJSON: one `engine`
 *                   event per engine as it finishes, then one `summary` event (`summary.ts`)
 *
 * Each engine runs in its own process (`engine-worker.ts`), so both model paths work: the
 * client path's config is read once per process. The model is the replay server unless the
 * request asks for `live` (#448), which the page sends only when you pick it. The live model
 * is available when `liveSettings` (`src/model/live.ts`) finds a key at startup and this
 * isn't CI; otherwise the page shows why and the API refuses a live run (`409`). The key
 * stays in the server and its engine processes, which scrub it from what they report.
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
 * never answers, and a same-origin `Origin` when one is sent (`403`), so no other site can
 * start a run, a paid live one included. It has no session token: the page reads nothing
 * secret, and the SQL runs as the fixture's read-only role.
 */
import { fork, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { MODELS, VIAS, type AskInput, type AskRun, type AskRunStatus, type Model, type TranscriptLine, type Via } from "../ask-run.js";
import { installRecord, requireInstallTarget } from "../artifacts.js";
import { SUPPORTED_DIALECTS, isSupportedDialect, type SupportedDialect } from "../dialects.js";
import type { Verdict as GradeVerdict } from "../grade.js";
import type { ExecuteResult } from "../host/execute.js";
import { loadQuestions } from "../model/catalog.js";
import { LiveModelError, liveSettings, type LiveSettings } from "../model/live.js";
import { LAB_ROOT } from "../paths.js";
import type { WorkerMessage, WorkerRequest } from "./engine-worker.js";
import { summarize } from "./summary.js";

const PAGE = new URL("./page.html", import.meta.url);
const WORKER = fileURLToPath(new URL("./engine-worker.ts", import.meta.url));
/** After `abort`, past the worker's own grace period (`ABORT_GRACE_MS` in `engine-worker.ts`). */
const KILL_AFTER_ABORT_MS = 3_000;
const BODY_LIMIT = 64 * 1024;

export interface LabUiOptions {
  /** Default 0: any free port. */
  port?: number;
  /** An engine with no result after this long is reported as timed out. Default 60 s. */
  engineTimeoutMs?: number;
}

/** Whether the page can offer the live model: its id, or why not (no key, or CI). */
export type LiveAvailability = { available: true; modelId: string } | { available: false; reason: string };

export interface LabUi {
  /** `http://127.0.0.1:<port>` */
  readonly url: string;
  readonly live: LiveAvailability;
  close(): Promise<void>;
}

/** What `POST /api/run` takes: `lab ask`'s input, its model and path, and the engines to run it on. */
export interface UiInput {
  question: string;
  sql?: string;
  /** Default `raw`. */
  via?: Via;
  /** Default `replay`. `live` isn't taken with `sql`, which calls no model. */
  model?: Model;
  /** Default every engine. */
  engines?: SupportedDialect[];
}

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
 * Stop a run: `abort` lets it kill its introspection and clean up; one still going after the
 * grace period (a database connection that hangs) is killed with its whole process group. A
 * server that exits first leaves that to the process, which aborts when the server goes away.
 */
function stopRun(child: ChildProcess): void {
  if (child.connected) child.send({ type: "abort" } satisfies WorkerRequest, () => {});
  setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }, KILL_AFTER_ABORT_MS).unref();
}

/**
 * Run the input on one engine in its own process (`engine-worker.ts`), giving up after
 * `timeoutMs`. Giving up, or `signal` (aborted when the server closes), stops the run
 * (`stopRun`), so nothing it started outlives it.
 * Returns the engine's event, and the rows it read, which the summary needs and the page doesn't.
 */
async function runEngine(
  dialect: SupportedDialect,
  input: AskInput,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<{ event: EngineEvent; rows?: ExecuteResult; verdict?: GradeVerdict }> {
  const started = performance.now();
  const lines: TranscriptLine[] = [];
  // Its own process group, so a kill reaches the processes it starts. It inherits the server's
  // execArgv, which load TypeScript as `tsx` does for `pnpm lab`.
  const child = fork(WORKER, [], { cwd: LAB_ROOT, detached: true, stdio: ["ignore", "inherit", "inherit", "ipc"] });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    stopRun(child);
  };
  signal.addEventListener("abort", stop, { once: true });
  let timer: NodeJS.Timeout | undefined;
  try {
    const outcome = await new Promise<Extract<WorkerMessage, { type: "done" }> | "timeout" | { exited: string }>((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
      child.on("message", (message: WorkerMessage) => {
        if (message.type === "line") lines.push(message.line);
        else resolve(message);
      });
      child.on("error", (error) => resolve({ exited: `engine process: ${error.message}` }));
      // `close`, not `exit`: it comes after every message the process sent.
      child.on("close", (code, sig) => resolve({ exited: `engine process exited (${sig ?? `code ${code}`}) before reporting a result` }));
      child.send({ type: "run", dialect, input } satisfies WorkerRequest);
    });
    if (outcome === "timeout") {
      return { event: { type: "engine", dialect, status: "timeout", lines, error: `no result after ${timeoutMs} ms`, timings: { totalMs: performance.now() - started } } };
    }
    if ("exited" in outcome) {
      return { event: { type: "engine", dialect, status: "failed", lines, error: outcome.exited, timings: { totalMs: performance.now() - started } } };
    }
    const event: EngineEvent = {
      type: "engine",
      dialect,
      status: outcome.status,
      exitCode: outcome.exitCode,
      lines,
      error: outcome.error,
      rowCount: outcome.rows?.rows.length,
      truncated: outcome.rows?.truncated,
      timings: outcome.timings,
    };
    return { event, rows: outcome.rows, verdict: outcome.verdict };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
    stop();
  }
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(target: string, live: LiveAvailability): string {
  // `<` escaped, so no value can close the <script> element the JSON sits in.
  const data = JSON.stringify({ dialects: SUPPORTED_DIALECTS, vias: VIAS, live, questions: loadQuestions() }).replace(/</g, "\\u003c");
  return readFileSync(PAGE, "utf8")
    .replace("<!--TARGET-->", () => escapeHtml(target))
    .replace("<!--LIVE_MODEL-->", () => escapeHtml(live.available ? live.modelId : `unavailable: ${live.reason}`))
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
  const { question = "", sql, via = "raw", model = "replay", engines = SUPPORTED_DIALECTS } = value as Record<string, unknown>;
  if (typeof question !== "string" || (sql !== undefined && typeof sql !== "string")) return undefined;
  if (!(VIAS as readonly unknown[]).includes(via) || !(MODELS as readonly unknown[]).includes(model)) return undefined;
  if (!Array.isArray(engines) || !engines.length || !engines.every((e) => typeof e === "string" && isSupportedDialect(e))) return undefined;
  const choice = { via: via as Via, model: model as Model, engines: SUPPORTED_DIALECTS.filter((d) => engines.includes(d)) };
  // SQL that was sent is what runs: blank SQL is refused, never replaced by its question. It
  // calls no model, so it can't be asked of the live one.
  if (sql !== undefined) return sql.trim() && model !== "live" ? { question: question.trim(), sql, ...choice } : undefined;
  return question.trim() ? { question: question.trim(), ...choice } : undefined;
}

/** The live model's settings, or why the page can't offer it. Read once, when the server starts. */
function readLive(): { settings?: LiveSettings; availability: LiveAvailability } {
  try {
    const settings = liveSettings("live mode");
    return { settings, availability: { available: true, modelId: settings.modelId } };
  } catch (error) {
    if (!(error instanceof LiveModelError)) throw error;
    return { availability: { available: false, reason: error.message } };
  }
}

export async function startLabUi(options: LabUiOptions = {}): Promise<LabUi> {
  const engineTimeoutMs = options.engineTimeoutMs ?? 60_000;
  const target = requireInstallTarget().label;
  const live = readLive();
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
      const html = page(target, live.availability);
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
      if (!input) {
        return sendText(
          res,
          400,
          `lab ui: send { "question": string, "sql"?: string, "via"?: ${VIAS.map((v) => `"${v}"`).join(" | ")}, "model"?: ${MODELS.map((m) => `"${m}"`).join(" | ")}, "engines"?: [dialect, …] } ` +
            "with a question, or with SQL that isn't blank (and no live model, which SQL doesn't call), and at least one engine",
        );
      }
      if (input.model === "live" && !live.settings) {
        return sendText(res, 409, `lab ui: the live model is unavailable: ${live.availability.available ? "" : live.availability.reason}`);
      }
      const ask: AskInput = { question: input.question, sql: input.sql, via: input.via, live: input.model === "live" ? live.settings : undefined };

      res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" });
      // Engines run concurrently; each column is sent as soon as its engine finishes.
      const runs = await Promise.all(
        input.engines!.map(async (dialect) => {
          const run = await runEngine(dialect, ask, engineTimeoutMs, closing.signal);
          res.write(`${JSON.stringify(run.event)}\n`);
          return run;
        }),
      );
      // Raw SQL is compared through the catalog question it's labelled with, if any.
      const summary = summarize(input.question, runs.map(({ event, rows, verdict }) => ({ dialect: event.dialect, status: event.status, rows, verdict })));
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
    live: live.availability,
    close: () =>
      new Promise<void>((resolve, reject) => {
        closing.abort();
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
