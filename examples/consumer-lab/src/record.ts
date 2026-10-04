/**
 * Records the catalog's replies (`scenarios/questions.json`) from a live OpenAI model (#247),
 * for `pnpm lab:record [--db <dialect>]… [--only <question-id>]…` (`src/record-cli.ts`).
 *
 * The replay server runs in record mode, proxying to OpenAI with the key (`src/model/live.ts`),
 * and each question is asked through the raw-model path, `createOpenAI()` → `ask()`, pointed at
 * it. Each reply is graded before anything is written (`src/grade.ts`): the SQL `ask()` returns,
 * run as the host, must return the oracle's rows, and the parameterized question must come back
 * parameterized. A reply that passes replaces the cassette, with `"source": "recorded"` and
 * `recordedWith` (the model the provider says answered, the install target, the date). A reply
 * that misses is listed, in the terminal and in `.lab/record-misses.json`, and leaves the
 * cassette as it was. The maintainer reviews the cassette diff in git: staging a file accepts it,
 * `git restore` rejects it.
 *
 * Only the catalog is recorded. The tenant and sensitive suites' replies are hand-written, many
 * of them as the attacker, and a model's reply would change what they test; `--only` refuses
 * their ids before any call is made.
 *
 * The key never reaches a file: the clients send the replay server a placeholder, the request
 * log holds no header, and a cassette that would contain the key is not written.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createOpenAI } from "@ai-sdk/openai";
import { API_KEY, askWithModel, settle } from "./ask.js";
import { ensureArtifact } from "./artifacts.js";
import { SUPPORTED_DIALECTS, type SupportedDialect } from "./dialects.js";
import { gradeCatalogAnswer } from "./grade.js";
import { CASSETTES_DIR, QUESTIONS_FILE, cassettePath, displayPath, loadQuestions, type Cassette, type Question } from "./model/catalog.js";
import { LiveModelError, type LiveSettings } from "./model/live.js";
import { redact, startReplayServer } from "./model/replay-server.js";

export interface RecordOptions {
  settings: LiveSettings;
  /** Default: every dialect. */
  dialects?: readonly SupportedDialect[];
  /** Catalog question ids. Default: the whole catalog. */
  only?: readonly string[];
  /** The install target's label, for `recordedWith.askdbTarget`. */
  target: string;
  /** Default: the lab's `cassettes/`. */
  cassettesDir?: string;
  /** Each reply's outcome, as it happens. */
  log?: (line: string) => void;
}

export interface RecordMiss {
  dialect: SupportedDialect;
  id: string;
  question: string;
  reason: string;
  /** The model's whole reply, when one came back, with anything shaped like a key redacted. */
  reply: string | null;
}

export interface RecordOutcome {
  written: { dialect: SupportedDialect; id: string }[];
  /** The reply equals the recorded cassette's, from the same model: rewriting would only change the date. */
  unchanged: { dialect: SupportedDialect; id: string }[];
  misses: RecordMiss[];
  /** Guarantee violations (`src/grade.ts`): SQL that passed AskDB's checks and broke one. Not written; a product failure to file. */
  violations: RecordMiss[];
}

/**
 * The install target as a cassette records it: the `askdb` version `lab:use` installed, and the
 * target's label without absolute paths, which would put the recorder's home directory in git
 * (`checkout /Users/me/AskDB @ b14da348` → `askdb@1.0.0-beta.43, checkout @ b14da348`).
 */
export function portableTarget(target: { label: string; packages?: { name: string; version: string }[] }): string {
  const label = target.label.replace(/ (?:\/|[A-Za-z]:\\)\S*/g, "");
  const askdb = target.packages?.find((p) => p.name === "askdb")?.version;
  return askdb ? `askdb@${askdb}, ${label}` : label;
}

/** A request failed (the provider refused it: a bad key, a quota, an outage): the run stops. */
export class RecordAbort extends Error {
  override name = "RecordAbort";
  constructor(
    message: string,
    /** What the run did before it stopped. */
    readonly outcome: RecordOutcome,
  ) {
    super(message);
  }
}

/** The catalog questions to record, or a refusal naming the ids that can't be recorded. */
export function selectQuestions(only: readonly string[] | undefined): Question[] {
  const catalog = loadQuestions();
  if (!only?.length) return catalog;
  const handWritten = only.filter((id) => /^(tenant|sensitive|safety)-/.test(id));
  if (handWritten.length) {
    throw new LiveModelError(
      `${handWritten.join(", ")}: hand-written test replies; lab:record only records the catalog questions in ${displayPath(QUESTIONS_FILE)}. ` +
        "The tenant and sensitive suites' replies play the attacker on purpose, and a model's reply would change what they test.",
    );
  }
  const unknown = only.filter((id) => !catalog.some((q) => q.id === id));
  if (unknown.length) throw new LiveModelError(`${unknown.join(", ")}: not in ${displayPath(QUESTIONS_FILE)}.`);
  return catalog.filter((q) => only.includes(q.id));
}

function readExisting(path: string): Cassette | undefined {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Cassette) : undefined;
}

export async function record(opts: RecordOptions): Promise<RecordOutcome> {
  const { settings } = opts;
  const questions = selectQuestions(opts.only);
  const dialects = opts.dialects?.length ? opts.dialects : SUPPORTED_DIALECTS;
  const cassettesDir = opts.cassettesDir ?? CASSETTES_DIR;
  const at = new Date().toISOString().slice(0, 10);
  const log = opts.log ?? (() => {});
  const outcome: RecordOutcome = { written: [], unchanged: [], misses: [], violations: [] };

  const proxy = await startReplayServer({
    cassettesDir,
    upstream: { baseURL: settings.baseURL, apiKey: settings.apiKey },
  });
  try {
    for (const dialect of dialects) {
      const schemaDir = ensureArtifact(dialect);
      // The placeholder key goes to the local proxy; the proxy holds the real one.
      const model = createOpenAI({ baseURL: proxy.baseURL(dialect), apiKey: API_KEY })(settings.modelId);
      for (const question of questions) {
        const asked = proxy.requests().length;
        const answer = await settle(askWithModel(dialect, question.text, schemaDir, model));
        const request = proxy.requests().slice(asked).at(-1);
        if (request?.error) throw new RecordAbort(request.error, outcome);
        // Anything but one of AskDB's rejections of the SQL: the grader rethrows it.
        const verdict = await gradeCatalogAnswer(dialect, question.id, answer);
        const reply = request?.reply == null ? null : redact(request.reply, settings.apiKey);
        const miss = (reason: string) => {
          outcome.misses.push({ dialect, id: question.id, question: question.text, reason, reply });
          log(`miss       [${dialect}] ${question.id}: ${reason}`);
        };
        if (verdict.status === "violation") {
          const reason = `${verdict.guarantee} violation: ${verdict.reason}`;
          outcome.violations.push({ dialect, id: question.id, question: question.text, reason, reply });
          log(`VIOLATION  [${dialect}] ${question.id}: ${reason}`);
          continue;
        }
        if (verdict.status === "miss") {
          miss(verdict.reason);
          continue;
        }
        const raw = request?.reply;
        if (!raw) {
          miss("the provider's reply had no text the lab could store");
          continue;
        }
        const cassette: Cassette = {
          question: question.text,
          reply: raw,
          source: "recorded",
          recordedWith: { model: request?.upstreamModel ?? settings.modelId, askdbTarget: opts.target, at },
        };
        const json = `${JSON.stringify(cassette, null, 2)}\n`;
        if (redact(json, settings.apiKey) !== json) {
          miss("the reply holds the API key or something shaped like one, so it wasn't written");
          continue;
        }
        const path = cassettePath(dialect, question.id, cassettesDir);
        const existing = readExisting(path);
        if (existing?.source === "recorded" && existing.reply === raw && existing.recordedWith?.model === cassette.recordedWith!.model) {
          outcome.unchanged.push({ dialect, id: question.id });
          log(`unchanged  [${dialect}] ${question.id}`);
          continue;
        }
        mkdirSync(join(cassettesDir, dialect), { recursive: true });
        writeFileSync(path, json);
        outcome.written.push({ dialect, id: question.id });
        log(`recorded   [${dialect}] ${question.id}`);
      }
    }
  } finally {
    await proxy.close();
  }
  return outcome;
}
