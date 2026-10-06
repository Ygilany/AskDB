/**
 * Ask → validate → execute on one engine: the one code path behind `pnpm lab ask` and
 * `pnpm lab ui`. `lab ask` prints the transcript this builds; `lab ui` shows it in the
 * engine's column, beside the structured outcome it summarizes across engines.
 *
 * The question goes through one of the two documented model paths, pointed at the lab's
 * replay server:
 *
 *   via raw     (default) a Vercel AI SDK `LanguageModel` from `createOpenAI({ baseURL })`,
 *               passed to `ask()` from `@askdb/core` (`askRaw`, in `ask.ts`);
 *   via client  `createAskDb` from `@askdb/client` with `@askdb/ai-openai`, configured by
 *               `askdb.config.ts` (`providerConfig.openai.baseUrl`).
 *
 * With `sql`, the SQL goes through `ask()` as if a model had written it (the documented
 * `deps.generateText` seam) and no model is called.
 *
 * Accepted SQL is executed on the fixture as the read-only role. Rejected SQL is never
 * executed.
 */
import { createHash } from "node:crypto";
import { openaiProvider } from "@askdb/ai-openai";
import { createAskDb } from "@askdb/client";
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
import { AskDbError } from "@askdb/core";
import { askFixedSql, askRaw, type AskResult } from "./ask.js";
import { ensureArtifactAsync, requireInstallTarget } from "./artifacts.js";
import type { SupportedDialect } from "./dialects.js";
import { executeReadOnly, type ExecuteResult } from "./host/execute.js";
import { startReplayServer, type ReplayServer } from "./model/replay-server.js";
import { LAB_ROOT } from "./paths.js";

export const VIAS = ["raw", "client"] as const;
export type Via = (typeof VIAS)[number];

export interface AskInput {
  /** The question. With `sql`, only the question `ask()` is given; it may be empty. */
  question: string;
  /** Skip the model: this SQL goes through `ask()` as the model's reply. */
  sql?: string;
  /** Default `raw`. `client` loads `askdb.config.ts`, which a process does only once (see `askClient`). */
  via?: Via;
}

export interface TranscriptLine {
  stream: "stdout" | "stderr";
  text: string;
}

/**
 * `ok`: accepted and executed. `rejected`: AskDB threw one of its documented errors.
 * `refused`: the replay server had no reply. `failed`: anything else (an engine that's down,
 * an execution error, a lab bug); `lab ask` lets it propagate.
 */
export type AskRunStatus = "ok" | "rejected" | "refused" | "failed";

export interface AskRun {
  dialect: SupportedDialect;
  status: AskRunStatus;
  /** What `lab ask` prints, in order. */
  lines: TranscriptLine[];
  /** `lab ask`'s exit code; undefined when `failed`, where it throws `error` instead. */
  exitCode?: 0 | 1;
  /** `ask()`'s result, once it returned. */
  result?: AskResult;
  /** The rows the read-only role read, when `ok`. */
  rows?: ExecuteResult;
  error?: unknown;
  /** `askMs`: `ask()` (prompt, model, validation). `executeMs`: the read-only execution. */
  timings: { askMs?: number; executeMs?: number; totalMs: number };
}

/**
 * Path (b): `createAskDb` with the OpenAI adapter (path (a) is `askRaw`, in `ask.ts`).
 * The model comes from `askdb.config.ts`, whose `baseUrl` reads LAB_REPLAY_BASE_URL. The
 * dialect is passed explicitly: MariaDB is introspected with the MySQL engine, so its
 * artifact records `mysql`. The config is loaded once per process, so only a process that
 * asks once (`lab ask`) can take this path.
 */
async function askClient(dialect: SupportedDialect, question: string, schemaDir: string, baseURL: string, log: (text: string) => void): Promise<AskResult> {
  process.env.LAB_REPLAY_BASE_URL = baseURL;
  bootstrapAskDbEnv({ cwd: LAB_ROOT });
  const askdb = createAskDb({
    config: getAskDbRuntimeConfig(),
    providers: [openaiProvider],
    schema: { path: schemaDir },
    dialect,
    onResolve: (info) => log(`resolved:   ${JSON.stringify(info)}`),
  });
  return askdb.ask(question);
}

/** Continuation lines line up under the first, after the 12-column labels. */
function indent(text: string): string {
  return text.replace(/\n/g, `\n${" ".repeat(12)}`);
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function formatRows(result: ExecuteResult): string {
  const cells = [result.columns, ...result.rows.map((row) => row.map(formatValue))];
  const widths = result.columns.map((_, i) => Math.max(...cells.map((r) => (r[i] as string).length)));
  const line = (r: string[]) => r.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd();
  const header = line(cells[0] as string[]);
  const n = result.rows.length;
  const count = result.truncated ? `more than ${n} rows (showing ${n})` : `${n} ${n === 1 ? "row" : "rows"}`;
  return [header, "-".repeat(header.length), ...cells.slice(1).map((r) => line(r as string[])), "", count].join("\n");
}

export interface AskRunOptions {
  /** Gets each transcript line as it's produced, so `lab ask` prints as it goes. */
  onLine?: (line: TranscriptLine) => void;
  /** Aborting it kills the run's child processes (introspection). Driver calls take no signal. */
  signal?: AbortSignal;
}

export async function askAndRun(dialect: SupportedDialect, input: AskInput, { onLine, signal }: AskRunOptions = {}): Promise<AskRun> {
  const started = performance.now();
  const lines: TranscriptLine[] = [];
  const emit = (stream: TranscriptLine["stream"]) => (text: string) => {
    const line = { stream, text };
    lines.push(line);
    onLine?.(line);
  };
  const out = emit("stdout");
  const err = emit("stderr");
  const timings: AskRun["timings"] = { totalMs: 0 };
  const done = (status: AskRunStatus, rest: Partial<AskRun> = {}): AskRun => {
    timings.totalMs = performance.now() - started;
    return { dialect, status, lines, timings, ...rest };
  };
  const timed = async <T>(key: "askMs" | "executeMs", work: () => Promise<T>): Promise<T> => {
    const t = performance.now();
    try {
      return await work();
    } finally {
      timings[key] = performance.now() - t;
    }
  };

  const { question, sql, via = "raw" } = input;
  let replay: ReplayServer | undefined;
  try {
    out(`target:     ${requireInstallTarget().label}`);
    out(`dialect:    ${dialect}`);
    const schemaDir = await ensureArtifactAsync(dialect, signal);

    // What the model was sent, as a digest: equal digests mean the two paths built the same prompt.
    const showPrompt = () => {
      const prompt = replay?.requests().at(-1)?.prompt;
      if (prompt) out(`prompt:     ${prompt.length} chars, sha256 ${createHash("sha256").update(prompt).digest("hex").slice(0, 16)}`);
    };
    let result: AskResult;
    try {
      if (sql !== undefined) {
        out("model:      none (--sql, through deps.generateText)");
        result = await timed("askMs", () => askFixedSql(dialect, sql, schemaDir, question || undefined));
      } else {
        replay = await startReplayServer();
        const baseURL = replay.baseURL(dialect);
        out(`model:      replay at ${baseURL}, via ${via === "raw" ? "createOpenAI() → ask()" : "createAskDb() + @askdb/ai-openai"}`);
        result = await timed("askMs", () => (via === "raw" ? askRaw(dialect, question, schemaDir, baseURL) : askClient(dialect, question, schemaDir, baseURL, out)));
        showPrompt();
      }
    } catch (error) {
      showPrompt();
      // A request the replay server refused: say what's missing, not AskDB's wrapping of it.
      const refused = replay?.requests().find((r) => r.error);
      if (refused) {
        err(refused.error!);
        return done("refused", { exitCode: 1, error });
      }
      // Only AskDB's documented errors (SqlValidationError, SensitiveReferenceError, tenant
      // errors, …, all AskDbError subclasses) are outcomes to report; anything else is a bug.
      if (!(error instanceof AskDbError)) throw error;
      const rule = "rule" in error ? ` ${String(error.rule)}` : "";
      const reply = sql ?? replay?.requests().at(-1)?.reply;
      if (reply) out(`${sql !== undefined ? "sql:  " : "reply:"}      ${indent(reply)}`);
      out(`validation: rejected — ${error.name}${rule}`);
      out(`            ${error.message}`);
      return done("rejected", { exitCode: 1, error });
    } finally {
      await replay?.close();
    }

    out(`sql:        ${indent(result.sql)}`);
    if (result.unboundSql) {
      out(`unbound:    ${indent(result.unboundSql)}`);
      out(`params:     ${JSON.stringify(result.params ?? [])}`);
    }
    out("validation: ok");
    if (result.sensitiveGuardrail && !result.sensitiveGuardrail.passed) {
      out(`sensitive:  ${JSON.stringify(result.sensitiveGuardrail.references)}`);
    }
    out("");
    const rows = await timed("executeMs", () => executeReadOnly(dialect, result.sql));
    out(formatRows(rows));
    return done("ok", { exitCode: 0, result, rows });
  } catch (error) {
    return done("failed", { error });
  }
}
