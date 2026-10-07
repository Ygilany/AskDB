/**
 * One engine's run for `pnpm lab ui`, in a process of its own (`src/ui/server.ts` forks it):
 * `askAndRun` (`src/ask-run.ts`) for the input it's sent, reported back over the IPC channel.
 *
 * A process per run is what lets the page take the client path: `createAskDb` reads its
 * config once per process, so in a shared process every engine would get the first one's
 * replay URL, and a replay run would pin the config a live run needs. It also lets the server
 * stop a run whole, by killing the process group: the run's introspection and any database
 * connection still hanging go with it.
 *
 * The live model's settings, key included, come over IPC, never on the command line or in
 * the environment, and every line the run reports is scrubbed of the key by `askAndRun`.
 */
import { askAndRun, type AskInput, type AskRunStatus, type TranscriptLine } from "../ask-run.js";
import type { SupportedDialect } from "../dialects.js";
import type { ExecuteResult } from "../host/execute.js";

export interface WorkerRequest {
  dialect: SupportedDialect;
  input: AskInput;
}

export type WorkerMessage =
  | { type: "line"; line: TranscriptLine }
  | {
      type: "done";
      status: AskRunStatus;
      exitCode?: 0 | 1;
      rows?: ExecuteResult;
      /** For `failed`: what went wrong. */
      error?: string;
      timings: { askMs?: number; executeMs?: number; totalMs: number };
    };

const send = (message: WorkerMessage) => new Promise<void>((resolve) => process.send!(message, () => resolve()));

/** Driver values that JSON can't carry as they are: a bigint as its digits, which the fixture's normalization reads. */
const toJson = <T>(value: T): T => JSON.parse(JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v))) as T;

process.once("message", async ({ dialect, input }: WorkerRequest) => {
  const run = await askAndRun(dialect, input, { onLine: (line) => void send({ type: "line", line }) });
  const error = run.status === "failed" ? (run.error instanceof Error ? `${run.error.name}: ${run.error.message}` : String(run.error)) : undefined;
  await send(toJson({ type: "done", status: run.status, exitCode: run.exitCode, rows: run.rows, error, timings: run.timings }));
  // A driver socket that never closes would keep the process alive.
  process.exit(0);
});
