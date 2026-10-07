/**
 * Records the catalog's replies (`scenarios/questions.json`) from a live OpenAI model (#247),
 * for `pnpm lab:record [--db <dialect>]… [--only <question-id>]…` (`src/record-cli.ts`).
 *
 * The replay server runs in record mode, proxying to OpenAI with the key (`src/model/live.ts`),
 * and each question is asked through the raw-model path, `createOpenAI()` → `ask()`, pointed at
 * it. Each reply is graded before anything is written (`src/grade.ts`): the SQL `ask()` returns,
 * run as the host, must return the oracle's rows, and the parameterized question must come back
 * parameterized. Its ```sql fence must also hold that SQL: the replay suites read a cassette's
 * fence (`fencedSql`) and compare it with what `ask()` returns by `sameStatement`, which ignores
 * a trailing semicolon on both sides, and `ask()` forgives another fence tag that they don't. A reply that passes
 * replaces the cassette, with `"source": "recorded"` and `recordedWith` (the model the provider
 * says answered, the install target, the date). A reply that misses is listed, in the terminal and in `.lab/record-misses.json`, and leaves the
 * cassette as it was. The maintainer reviews the cassette diff in git: staging a file accepts it,
 * `git restore` rejects it.
 *
 * Only the catalog is recorded. The tenant and sensitive suites' replies are hand-written, many
 * of them as the attacker, and a model's reply would change what they test; `--only` refuses
 * their ids before any call is made.
 *
 * The key never reaches a file: the clients send the replay server a placeholder, the request
 * log holds no header, and a cassette that would contain the key is not written.
 *
 * Any error that stops the run (the provider refusing a request, the fixture down, a model call
 * AskDB couldn't make) becomes a {@link RecordAbort} carrying what the run did until then, with the
 * key redacted, so `.lab/record-misses.json` still lists it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createOpenAI } from "@ai-sdk/openai";
import { API_KEY, askWithModel, settle } from "./ask.js";
import { ensureArtifact } from "./artifacts.js";
import { SUPPORTED_DIALECTS, type SupportedDialect } from "./dialects.js";
import { gradeCatalogAnswer } from "./grade.js";
import { CASSETTES_DIR, QUESTIONS_FILE, cassettePath, displayPath, fencedSql, loadQuestions, sameStatement, type Cassette, type Question } from "./model/catalog.js";
import { redact, type LiveSettings } from "./model/live.js";
import { startReplayServer } from "./model/replay-server.js";

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
  // Only `lab:use <path>` labels hold a path: `checkout <path> @ <commit> (<branch>)`. The path may contain spaces.
  const label = target.label.replace(/^checkout .+? @ /, "checkout @ ");
  const askdb = target.packages?.find((p) => p.name === "askdb")?.version;
  return askdb ? `askdb@${askdb}, ${label}` : label;
}

/** A question id `lab:record` won't ask: a hand-written test reply's, or one the catalog doesn't have. Nothing was called. */
export class RecordRefusal extends Error {
  override name = "RecordRefusal";
}

/** The run stopped: the provider refused a request (a bad key, a quota, an outage), or the fixture or the model call failed. */
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
    throw new RecordRefusal(
      `${handWritten.join(", ")}: hand-written test replies; lab:record only records the catalog questions in ${displayPath(QUESTIONS_FILE)}. ` +
        "The tenant and sensitive suites' replies play the attacker on purpose, and a model's reply would change what they test.",
    );
  }
  const unknown = only.filter((id) => !catalog.some((q) => q.id === id));
  if (unknown.length) throw new RecordRefusal(`${unknown.join(", ")}: not in ${displayPath(QUESTIONS_FILE)}.`);
  return catalog.filter((q) => only.includes(q.id));
}

export async function record(opts: RecordOptions): Promise<RecordOutcome> {
  const { settings } = opts;
  const questions = selectQuestions(opts.only);
  const dialects = opts.dialects?.length ? opts.dialects : SUPPORTED_DIALECTS;
  const cassettesDir = opts.cassettesDir ?? CASSETTES_DIR;
  const at = new Date().toISOString().slice(0, 10);
  const log = opts.log ?? (() => {});
  const outcome: RecordOutcome = { written: [], misses: [], violations: [] };

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
        const fenced = fencedSql(raw);
        if (answer.ok && (fenced === undefined || !sameStatement(answer.result.sql, fenced))) {
          miss("the reply's ```sql fence doesn't hold the SQL ask() returned (another fence tag, a second fence), so the replay suites would read other SQL");
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
        mkdirSync(join(cassettesDir, dialect), { recursive: true });
        writeFileSync(path, json);
        outcome.written.push({ dialect, id: question.id });
        log(`recorded   [${dialect}] ${question.id}`);
      }
    }
  } catch (error) {
    if (error instanceof RecordAbort) throw error;
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new RecordAbort(redact(message, settings.apiKey), outcome);
  } finally {
    await proxy.close();
  }
  return outcome;
}

export interface RecordReport {
  /** 0 when every question was asked (misses included); 1 when the run stopped or a reply broke a guarantee. */
  exitCode: number;
  /** What to print after the per-reply lines. */
  summary: string[];
}

/**
 * Writes `missesFile` (every miss and violation, each reply redacted) and says how the run ends.
 * `stopped` is a {@link RecordAbort}'s message: the file still lists what the run found before it.
 */
export function writeRecordReport(outcome: RecordOutcome, model: string, missesFile: string, stopped?: string): RecordReport {
  mkdirSync(dirname(missesFile), { recursive: true });
  writeFileSync(missesFile, `${JSON.stringify({ generatedAt: new Date().toISOString(), model, stopped: stopped ?? null, misses: outcome.misses, violations: outcome.violations }, null, 2)}\n`);
  const summary = [
    "",
    `${outcome.written.length} recorded, ${outcome.misses.length} missed (not written; listed in ${displayPath(missesFile)}).`,
    ...(outcome.violations.length ? [`${outcome.violations.length} guarantee violation(s), not written: a product failure to file (listed in ${displayPath(missesFile)}).`] : []),
    ...(outcome.written.length ? ["Review: git diff examples/consumer-lab/cassettes/  (stage what you accept, git restore what you reject)"] : []),
  ];
  return { exitCode: stopped || outcome.violations.length ? 1 : 0, summary };
}
