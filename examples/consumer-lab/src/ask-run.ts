/**
 * Ask → validate → execute on one engine: the one code path behind `pnpm lab ask` and
 * `pnpm lab ui`. `lab ask` prints the transcript this builds; `lab ui` shows it in the
 * engine's column, beside the structured outcome it summarizes across engines.
 *
 * The question goes through one of the two documented model paths, pointed at the lab's
 * replay server, or with `live` at the live OpenAI model (`src/model/live.ts`, #448):
 *
 *   via raw     (default) a Vercel AI SDK `LanguageModel` from `createOpenAI()`, passed to
 *               `ask()` from `@askdb/core` (`askRaw`, in `ask.ts`);
 *   via client  `createAskDb` from `@askdb/client` with `@askdb/ai-openai`, configured by
 *               `askdb.config.ts` (`providerConfig.openai.baseUrl`), or for the live model
 *               by `live/askdb.config.ts`.
 *
 * With `sql`, the SQL goes through `ask()` as if a model had written it (the documented
 * `deps.generateText` seam) and no model is called.
 *
 * Accepted SQL is executed on the fixture as the read-only role. Rejected SQL is never
 * executed. A live answer to a catalog question ends with the oracle's verdict
 * (`gradeCatalogAnswer`, `src/grade.ts`). Everything a live run prints is scrubbed of the
 * key with `redact`.
 */
import { createHash } from "node:crypto";
import { openaiProvider } from "@askdb/ai-openai";
import { createAskDb } from "@askdb/client";
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
import { createOpenAI } from "@ai-sdk/openai";
import { AskDbError } from "@askdb/core";
import { join } from "node:path";
import { askFixedSql, askRaw, askWithModel, type AskResult, type Settled } from "./ask.js";
import { ensureArtifactAsync, requireInstallTarget } from "./artifacts.js";
import type { SupportedDialect } from "./dialects.js";
import { gradeCatalogAnswer, type Verdict } from "./grade.js";
import { executeReadOnly, type ExecuteResult } from "./host/execute.js";
import { loadQuestions } from "./model/catalog.js";
import { DEFAULT_LIVE_MODEL_ID, redact, type LiveSettings } from "./model/live.js";
import { replyText } from "./model/openai-wire.js";
import { startReplayServer, type ReplayServer } from "./model/replay-server.js";
import { LAB_ROOT } from "./paths.js";

export const VIAS = ["raw", "client"] as const;
export type Via = (typeof VIAS)[number];

export interface AskInput {
  /** The question. With `sql`, only the question `ask()` is given; it may be empty. */
  question: string;
  /** Skip the model: this SQL goes through `ask()` as the model's reply. */
  sql?: string;
  /** Default `raw`. `client` loads an AskDB config, which a process does only once (see `askClient`). */
  via?: Via;
  /** Ask the live model with these settings (`liveSettings`) instead of the replay server. Not with `sql`. */
  live?: LiveSettings;
}

export interface TranscriptLine {
  stream: "stdout" | "stderr";
  text: string;
}

/**
 * `ok`: accepted and executed. `rejected`: AskDB threw one of its documented errors.
 * `refused`: the model gave no reply: the replay server had none, or the live model call
 * failed (a bad key, a quota, an outage). `failed`: anything else (an engine that's down, an
 * execution error, a lab bug); `lab ask` lets it propagate.
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

/** Live mode's AskDB config, apart from the lab's own so no other surface sees a key. */
const LIVE_PROJECT = join(LAB_ROOT, "live");

/**
 * Path (b): `createAskDb` with the OpenAI adapter (path (a) is `askRaw`, in `ask.ts`).
 * The model comes from `askdb.config.ts`, whose `baseUrl` reads LAB_REPLAY_BASE_URL, or for
 * the live model from `live/askdb.config.ts`, which reads OPENAI_API_KEY and
 * LAB_LIVE_MODEL_ID and has no base URL. The dialect is passed explicitly: MariaDB is
 * introspected with the MySQL engine, so its artifact records `mysql`. The config is loaded
 * once per process, so only a process that asks once (`lab ask`, a `lab ui` engine run) can
 * take this path.
 */
async function askClient(dialect: SupportedDialect, question: string, schemaDir: string, model: { replayURL: string } | { live: LiveSettings }, log: (text: string) => void): Promise<AskResult> {
  if ("live" in model) {
    // This process asks once and ends: the key goes no further than its own environment.
    process.env.OPENAI_API_KEY = model.live.apiKey;
    if (model.live.modelId !== DEFAULT_LIVE_MODEL_ID) process.env.LAB_LIVE_MODEL_ID = model.live.modelId;
    bootstrapAskDbEnv({ cwd: LIVE_PROJECT });
  } else {
    process.env.LAB_REPLAY_BASE_URL = model.replayURL;
    bootstrapAskDbEnv({ cwd: LAB_ROOT });
  }
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

/**
 * The raw path to the live model, and the reply it gave, read through the AI SDK's documented
 * `fetch` option: a rejection carries no SQL, so the reply is what shows why.
 */
function askLiveRaw(dialect: SupportedDialect, question: string, schemaDir: string, live: LiveSettings): { answer: Promise<AskResult>; reply: () => string | null } {
  let reply: string | null = null;
  const openai = createOpenAI({
    apiKey: live.apiKey,
    baseURL: live.baseURL,
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      reply = replyText((await response.clone().json().catch(() => ({}))) as Record<string, unknown>);
      return response;
    },
  });
  return { answer: askWithModel(dialect, question, schemaDir, openai(live.modelId)), reply: () => reply };
}

/** The oracle line: `pass`, or the miss or violation with its reason. */
function verdictText(verdict: Verdict): string {
  if (verdict.status === "pass") return "pass";
  if (verdict.status === "miss") return `miss — ${verdict.reason}`;
  return `violation (${verdict.guarantee}) — ${verdict.reason}`;
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
  const { question, sql, via = "raw", live } = input;
  // A live run prints nothing holding the key: providers echo part of a rejected one.
  const scrub = (text: string) => (live ? redact(text, live.apiKey) : text);
  const emit = (stream: TranscriptLine["stream"]) => (text: string) => {
    const line = { stream, text: scrub(text) };
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

  /** The error with the key redacted from its message, and no stack (which repeats the message). */
  const scrubbed = (error: unknown): unknown => {
    if (!live) return error;
    const copy = new Error(scrub(error instanceof Error ? error.message : String(error)));
    copy.name = error instanceof Error ? error.name : "Error";
    copy.stack = `${copy.name}: ${copy.message}`;
    return copy;
  };
  // A live answer to a catalog question is graded against its oracle.
  const questionId = live ? loadQuestions().find((q) => q.text === question.trim())?.id : undefined;
  const grade = async (answer: Settled): Promise<Verdict | undefined> => {
    if (!questionId) {
      out("oracle:     none (not a catalog question)");
      return undefined;
    }
    const verdict = await gradeCatalogAnswer(dialect, questionId, answer);
    out(`oracle:     ${verdictText(verdict)}`);
    return verdict;
  };
  let replay: ReplayServer | undefined;
  let liveReply: (() => string | null) | undefined;
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
      } else if (live && via === "raw") {
        out(`model:      live ${live.modelId} at ${live.baseURL}, via createOpenAI() → ask()`);
        const asked = askLiveRaw(dialect, question, schemaDir, live);
        liveReply = asked.reply;
        result = await timed("askMs", () => asked.answer);
      } else if (live) {
        out("model:      live, via createAskDb() + @askdb/ai-openai (live/askdb.config.ts)");
        result = await timed("askMs", () => askClient(dialect, question, schemaDir, { live }, out));
      } else {
        replay = await startReplayServer();
        const baseURL = replay.baseURL(dialect);
        out(`model:      replay at ${baseURL}, via ${via === "raw" ? "createOpenAI() → ask()" : "createAskDb() + @askdb/ai-openai"}`);
        result = await timed("askMs", () => (via === "raw" ? askRaw(dialect, question, schemaDir, baseURL) : askClient(dialect, question, schemaDir, { replayURL: baseURL }, out)));
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
      // A live model call that failed (AskDB's "Model call failed"): there's no reply to judge.
      if (live && error instanceof AskDbError && error.name === "SqlGenerationError") {
        err(`model call failed: ${error.name}: ${error.message}`);
        return done("refused", { exitCode: 1, error: scrubbed(error) });
      }
      // Only AskDB's documented errors (SqlValidationError, SensitiveReferenceError, tenant
      // errors, …, all AskDbError subclasses) are outcomes to report; anything else is a bug.
      if (!(error instanceof AskDbError)) throw error;
      const rule = "rule" in error ? ` ${String(error.rule)}` : "";
      const reply = sql ?? replay?.requests().at(-1)?.reply ?? liveReply?.();
      if (reply) out(`${sql !== undefined ? "sql:  " : "reply:"}      ${indent(reply)}`);
      out(`validation: rejected — ${error.name}${rule}`);
      out(`            ${error.message}`);
      // An error the grader doesn't count as a rejection of the model's SQL gets no verdict.
      if (live) await grade({ ok: false, error }).catch(() => undefined);
      return done("rejected", { exitCode: 1, error: scrubbed(error) });
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
    // The grader runs the SQL again as the host and compares the rows with the oracle's.
    const verdict = live ? await grade({ ok: true, result }) : undefined;
    return done("ok", { exitCode: verdict?.status === "violation" ? 1 : 0, result, rows });
  } catch (error) {
    return done("failed", { error: scrubbed(error) });
  }
}
