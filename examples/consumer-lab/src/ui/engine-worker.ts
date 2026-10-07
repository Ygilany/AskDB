/**
 * One engine's run for `pnpm lab ui`, in a process of its own (`src/ui/server.ts` forks it):
 * `askAndRun` (`src/ask-run.ts`) for the input it's sent, reported back over the IPC channel.
 *
 * A process per run is what lets the page take the client path: `createAskDb` reads its
 * config once per process, so in a shared process every engine would get the first one's
 * replay URL, and a replay run would pin the config a live run needs. It also lets the server
 * stop a run whole: it sends `abort`, which kills the run's introspection and lets its scratch
 * directories be cleaned up, and a run still going after that (a database connection that
 * hangs) is killed with its process group. A process whose server went away aborts the same way.
 *
 * The live model's settings, key included, come over IPC, never on the command line or in
 * the environment, and every line the run reports is scrubbed of the key by `askAndRun`.
 */
import { askAndRun, type AskInput, type AskRunStatus, type TranscriptLine } from "../ask-run.js";
import type { SupportedDialect } from "../dialects.js";
import type { Verdict } from "../grade.js";
import type { ExecuteResult } from "../host/execute.js";

/** The run to do, then possibly `abort`. */
export type WorkerRequest = { type: "run"; dialect: SupportedDialect; input: AskInput } | { type: "abort" };

/** How long an aborted run has to clean up and report before this process exits anyway. */
export const ABORT_GRACE_MS = 2_000;

export type WorkerMessage =
  | { type: "line"; line: TranscriptLine }
  | {
      type: "done";
      status: AskRunStatus;
      exitCode?: 0 | 1;
      rows?: ExecuteResult;
      verdict?: Verdict;
      /** For `failed`: what went wrong. */
      error?: string;
      timings: { askMs?: number; executeMs?: number; totalMs: number };
    };

/** Report to the server, if it's still there to hear it. */
const send = (message: WorkerMessage) =>
  new Promise<void>((resolve) => {
    if (!process.connected) return resolve();
    process.send!(message, () => resolve());
  });

/** Driver values that JSON can't carry as they are: a bigint as its digits, which the fixture's normalization reads. */
const toJson = <T>(value: T): T => JSON.parse(JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v))) as T;

const aborted = new AbortController();
function abort(): void {
  aborted.abort();
  // The signal reaches introspection only: a driver call, or SQLite's statement process, runs
  // on. After the grace period, end the whole process group this process leads (the server
  // forks it detached), so nothing it started outlives it, even when the server is gone.
  setTimeout(() => process.kill(-process.pid, "SIGKILL"), ABORT_GRACE_MS).unref();
}
process.once("disconnect", abort);

process.on("message", async (request: WorkerRequest) => {
  if (request.type === "abort") return abort();
  const run = await askAndRun(request.dialect, request.input, { onLine: (line) => void send({ type: "line", line }), signal: aborted.signal });
  const error = run.status === "failed" ? (run.error instanceof Error ? `${run.error.name}: ${run.error.message}` : String(run.error)) : undefined;
  await send(toJson({ type: "done", status: run.status, exitCode: run.exitCode, rows: run.rows, verdict: run.verdict, error, timings: run.timings }));
  // A driver socket that never closes would keep the process alive.
  process.exit(0);
});
