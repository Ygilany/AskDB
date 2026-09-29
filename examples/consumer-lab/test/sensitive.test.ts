/**
 * Sensitive columns: with `people.client.email` and `people.client.ssn` marked `sensitive`
 * (the overlay `scenarios/overlay/sensitive-columns.json`, applied by `src/sensitive.ts`),
 * the prompt the model receives tags them, every documented omission switch removes them,
 * and a reply that reads them is flagged in warn mode and rejected in strict mode. The
 * contract is `docs/contracts/sensitive-fields-and-modes.md`; the design is
 * `docs/specs/consumer-lab.md`, "Sensitive columns".
 *
 * The prompt assertions read what the model actually received: the replay server's request
 * log, `GET /__lab/requests`, never AskDB's internals. The replies are this suite's own
 * catalog (`scenarios/sensitive-questions.json`, `cassettes/<dialect>/sensitive-*.json`),
 * each written in the dialect's own SQL and quoting. A reply that reads a sensitive column
 * is also run as the host, which shows it really returns the seeded values (so the flag
 * guards real data), and the control reply, which reads none, returns none of them.
 *
 * Each scenario's contract, the regression it catches, and why nothing else catches it are
 * stated above its `describe`. None needs a production seam: the `sensitive` flag is a
 * documented `schema.json` field (`docs/contracts/schema-v2.md`); the omission switches, the
 * guardrail mode and `SensitiveReferenceError` are documented (`reference/core-api.mdx`,
 * `reference/client-api.mdx`, `reference/cli.mdx`, `reference/http-api.mdx`,
 * `reference/config.mdx`); the replay server and its request log are lab code.
 *
 * Known discrepancies, marked `it.fails`: `askdb-http` ignores config
 * `modes.omitSensitiveFromPrompt` (#376), and `ASKDB_OMIT_SENSITIVE_FROM_PROMPT` is never read
 * from the environment (#377).
 *
 * Needs the fixture (`pnpm fixture:up`) and an installed lab (`pnpm lab:use .`). Every
 * scenario needs `cli-introspect-engine`, and on MySQL and MariaDB `mysql-databases`, whose
 * artifact otherwise has no `people.client` to mark; `sensitive-wildcard` needs
 * `sensitive-wildcards` (`src/capabilities.ts`).
 */
import { SensitiveReferenceError } from "@askdb/core";
import { createOpenAI } from "@ai-sdk/openai";
import { openaiProvider } from "@askdb/ai-openai";
import { createAskDb } from "@askdb/client";
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, type TestContext } from "vitest";
import { API_KEY, MODEL_ID, askRaw, type AskExtras, type AskResult } from "../src/ask.js";
import { needsCapability } from "../src/capabilities.js";
import { SUPPORTED_DIALECTS, type SupportedDialect } from "../src/dialects.js";
import { loadRows } from "../src/fixture.js";
import { executeReadOnly } from "../src/host/execute.js";
import { postAsk, startHttpServer, type HttpServer } from "../src/http-api.js";
import { askdbAsync } from "../src/introspect.js";
import { cassetteSql, loadQuestions, type Question } from "../src/model/catalog.js";
import { startReplayServer, type RecordedRequest, type ReplayServer } from "../src/model/replay-server.js";
import { LAB_ROOT, LAB_STATE } from "../src/paths.js";
import { removeSensitiveArtifact, sensitiveArtifact, sensitiveColumns } from "../src/sensitive.js";

const SENSITIVE_QUESTIONS = join(LAB_ROOT, "scenarios", "sensitive-questions.json");
const QUESTIONS = loadQuestions(SENSITIVE_QUESTIONS);

/** The overlay's columns: `email` and `ssn`, both of `people.client`. */
const SENSITIVE = sensitiveColumns().map((c) => c.column);
/** Columns of `people.client` the overlay leaves unmarked, which appear in no other table. */
const UNMARKED_CLIENT_COLUMNS = ["full_name", "birth_date"];
/** The seeded clients: what a reply that reads a sensitive column returns. */
const CLIENTS = loadRows({ schema: "people", name: "client" });

/** The control: a reply that reads only unmarked columns. Also the question the prompt scenarios ask. */
const CONTROL = "sensitive-client-names";

type MatchKind = "qualified" | "unqualified" | "table";
interface Reading {
  id: string;
  /** How the reply reads the column, for the test name. */
  shape: string;
  /** What the guardrail must report: `[column, matchKind]` (`reference/core-api.mdx`, `SensitiveReference`). */
  references: [string, MatchKind][];
  /** The sensitive columns whose every seeded value the reply returns when run; it returns none of the others'. */
  returns: string[];
}

/** Replies that name a sensitive column, each a different shape the heuristic must see. */
const COLUMN_READS: Reading[] = [
  { id: "sensitive-client-ssns", shape: "a bare column", references: [["ssn", "unqualified"]], returns: ["ssn"] },
  { id: "sensitive-client-emails", shape: "an alias-qualified column", references: [["email", "qualified"]], returns: ["email"] },
  { id: "sensitive-client-quoted", shape: "the dialect's quoted identifiers", references: [["ssn", "qualified"]], returns: ["ssn"] },
  { id: "sensitive-clients-without-ssn", shape: "a WHERE filter only", references: [["ssn", "unqualified"]], returns: [] },
];

/** Replies that reach the sensitive columns through a wildcard, naming none of them. */
const WILDCARD_READS: Reading[] = [
  { id: "sensitive-client-all-columns", shape: "SELECT *", references: [["email", "unqualified"], ["ssn", "unqualified"]], returns: ["email", "ssn"] },
  { id: "sensitive-client-rows-with-agency", shape: "alias.* on a join", references: [["email", "qualified"], ["ssn", "qualified"]], returns: ["email", "ssn"] },
];

mkdirSync(LAB_STATE, { recursive: true });
// Inside the lab, so a scratch project's `@askdb/config` import resolves from its node_modules.
const scratch = mkdtempSync(join(LAB_STATE, "sensitive-"));
let replay: ReplayServer;
const artifacts = new Map<SupportedDialect, string>();
/** `askdb-http` servers by key, started on first use (after the test's capability gate). */
const httpServers = new Map<string, Promise<HttpServer>>();

beforeAll(async () => {
  replay = await startReplayServer({ questionsFile: SENSITIVE_QUESTIONS });
});

afterAll(async () => {
  await Promise.all([...httpServers.values()].map((s) => s.then((running) => running.close(), () => {})));
  await replay?.close();
  for (const dir of artifacts.values()) removeSensitiveArtifact(dir);
  rmSync(scratch, { recursive: true, force: true });
});

/** The capabilities every scenario needs: the artifacts, and on MySQL and MariaDB, the `people` database in them. */
function needsSensitiveCapabilities(ctx: TestContext, dialect: SupportedDialect): void {
  needsCapability(ctx, "cli-introspect-engine");
  if (dialect === "mysql" || dialect === "mariadb") needsCapability(ctx, "mysql-databases");
}

function question(id: string): Question {
  const found = QUESTIONS.find((q) => q.id === id);
  if (!found) throw new Error(`${id} isn't in scenarios/sensitive-questions.json`);
  return found;
}

/** The dialect's artifact with the overlay applied, built once per dialect. */
function artifact(dialect: SupportedDialect): string {
  if (!artifacts.has(dialect)) artifacts.set(dialect, sensitiveArtifact(dialect));
  return artifacts.get(dialect)!;
}

function ask(dialect: SupportedDialect, id: string, extras: AskExtras = {}): Promise<AskResult> {
  return askRaw(dialect, question(id).text, artifact(dialect), replay.baseURL(dialect), extras);
}

type Settled = { ok: true; result: AskResult } | { ok: false; error: unknown };
const settle = (p: Promise<AskResult>): Promise<Settled> => p.then((result) => ({ ok: true, result }), (error: unknown) => ({ ok: false, error }));

/** The replay server's request log, as `GET /__lab/requests` serves it. */
async function requestLog(): Promise<RecordedRequest[]> {
  const res = await fetch(`${replay.url}/__lab/requests`);
  expect(res.status).toBe(200);
  return (await res.json()) as RecordedRequest[];
}

/** The model calls `run` makes: the entries it adds to the request log. */
async function callsOf(run: () => Promise<unknown>): Promise<RecordedRequest[]> {
  const before = (await requestLog()).length;
  await run();
  return (await requestLog()).slice(before);
}

/** The prompt of the one model call `run` makes, which must be the question `id` on `dialect`, answered. */
async function promptOf(dialect: SupportedDialect, id: string, run: () => Promise<unknown>): Promise<string> {
  const calls = await callsOf(run);
  expect(calls.map((c) => [c.dialect, c.questionId, c.error])).toEqual([[dialect, id, null]]);
  return calls[0]!.prompt;
}

const names = (column: string) => new RegExp(`\\b${column}\\b`);

/**
 * The default prompt: each sensitive column is named, and every line naming it carries the
 * `(sensitive)` tag; no other line carries the tag.
 */
function expectTagged(prompt: string): void {
  const lines = prompt.split("\n");
  for (const column of SENSITIVE) {
    const naming = lines.filter((l) => names(column).test(l));
    expect(naming, `the prompt never names ${column}`).not.toEqual([]);
    for (const line of naming) expect(line, `${column} is named without its (sensitive) tag`).toContain("(sensitive)");
  }
  const tagged = lines.filter((l) => l.includes("(sensitive)"));
  expect(tagged.filter((l) => !SENSITIVE.some((c) => names(c).test(l))), "a column the overlay leaves unmarked is tagged").toEqual([]);
}

/**
 * An omitted prompt: neither sensitive column is named and nothing is tagged, while the rest
 * of `people.client` is still described (so the table itself didn't disappear).
 */
function expectOmitted(prompt: string): void {
  for (const column of SENSITIVE) expect(prompt, `the prompt still names ${column}`).not.toMatch(names(column));
  expect(prompt).not.toContain("(sensitive)");
  for (const column of UNMARKED_CLIENT_COLUMNS) expect(prompt, `the prompt lost people.client's ${column}`).toMatch(names(column));
}

/** The references the guardrail must report for a reply, as `SensitiveReference`s, sorted. */
function expectedReferences(dialect: SupportedDialect, refs: [string, MatchKind][]) {
  // SQLite's artifact renders every table under `public`.
  const schema = dialect === "sqlite" ? "public" : "people";
  return refs.map(([column, matchKind]) => ({ table: "client", schema, column, matchKind })).sort(byColumn);
}
const byColumn = (a: { column: string; matchKind: string }, b: { column: string; matchKind: string }) =>
  `${a.column}/${a.matchKind}`.localeCompare(`${b.column}/${b.matchKind}`);
const sorted = <T extends { column: string; matchKind: string }>(refs: readonly T[] | undefined) => [...(refs ?? [])].sort(byColumn);

/**
 * For each sensitive column, how many of its seeded (non-null) values appear in the rows the
 * SQL returns, run as the read-only role. The seed data, not SQL, says what the values are.
 */
async function seededValuesReturned(dialect: SupportedDialect, sql: string): Promise<Record<string, number>> {
  const result = await executeReadOnly(dialect, sql);
  expect(result.truncated, "the host's row cap cut the result").toBe(false);
  expect(result.rows.length, "the reply returned no rows, so it shows nothing").toBeGreaterThan(0);
  const cells = new Set(result.rows.flat().map(String));
  return Object.fromEntries(SENSITIVE.map((column) => [column, CLIENTS.filter((c) => c[column] != null && cells.has(String(c[column]))).length]));
}

/** What {@link seededValuesReturned} gives for SQL that returns every seeded value of `columns`, and none of the others. */
function allSeededValuesOf(columns: readonly string[]): Record<string, number> {
  return Object.fromEntries(SENSITIVE.map((column) => [column, columns.includes(column) ? CLIENTS.filter((c) => c[column] != null).length : 0]));
}

/**
 * Warn mode (the default): the reply's SQL comes back unchanged, `sensitiveGuardrail` fails
 * with exactly the reading's references, and run as the host, the SQL returns the seeded
 * values of the columns the reading says it returns.
 */
async function expectWarned(dialect: SupportedDialect, reading: Reading): Promise<void> {
  const result = await ask(dialect, reading.id);

  expect(result.sql).toBe(cassetteSql(dialect, reading.id, QUESTIONS));
  expect(result.sensitiveGuardrail, `${reading.shape} wasn't flagged`).toMatchObject({ passed: false });
  expect(sorted(result.sensitiveGuardrail?.references), `the references for ${reading.shape}`).toEqual(expectedReferences(dialect, reading.references));
  expect(await seededValuesReturned(dialect, result.sql), "run as the host, the seeded values the reply returns").toEqual(allSeededValuesOf(reading.returns));
}

/**
 * Strict mode: the model answers, and `ask()` throws `SensitiveReferenceError`
 * `SENSITIVE_COLUMN_REFERENCED` with exactly the reading's references instead of returning
 * the SQL.
 */
async function expectRejected(dialect: SupportedDialect, reading: Reading): Promise<void> {
  let outcome!: Settled;

  const calls = await callsOf(async () => (outcome = await settle(ask(dialect, reading.id, { sensitiveGuardrailMode: "strict" }))));

  // The model answered; AskDB rejected what it wrote.
  expect(calls.map((c) => [c.questionId, c.error])).toEqual([[reading.id, null]]);
  expect(outcome.ok ? outcome.result.sql : undefined, "strict mode returned SQL that reads a sensitive column").toBeUndefined();
  const error = outcome.ok ? undefined : outcome.error;
  expect(error).toBeInstanceOf(SensitiveReferenceError);
  expect(error).toMatchObject({ rule: "SENSITIVE_COLUMN_REFERENCED" });
  expect(sorted((error as SensitiveReferenceError).references), `the references for ${reading.shape}`).toEqual(expectedReferences(dialect, reading.references));
}

describe.each(SUPPORTED_DIALECTS.map((d) => [d] as [SupportedDialect]))("[%s]", (dialect) => {
  /**
   * Contract: the default NL→SQL prompt "includes sensitive identifiers (column names, types,
   * nullability) … tagged `(sensitive)` on each line" (`docs/contracts/sensitive-fields-and-modes.md`,
   * "Current behavior"; `reference/core-api.mdx`, `omitSensitiveIdentifiersFromNlToSqlPrompt`:
   * "Default (`false`) includes them with a `(sensitive)` tag").
   * Catches: the tag lost (the model is no longer warned), the columns dropped by default (the
   * model can't ground a question about them), the flag not read from `schema.json`, or the
   * tag put on unmarked columns.
   * Not covered elsewhere: core's prompt tests format workspace source in-process; nothing
   * reads the prompt the packed build sends a model over HTTP, per dialect artifact.
   */
  describe("sensitive-prompt-tagged", () => {
    it("sensitive-prompt-tagged: the prompt the model receives names email and ssn, each tagged (sensitive), and tags nothing else", async (ctx) => {
      needsSensitiveCapabilities(ctx, dialect);

      const prompt = await promptOf(dialect, CONTROL, () => ask(dialect, CONTROL));

      expectTagged(prompt);
    });
  });

  /**
   * Contract: with `omitSensitiveIdentifiersFromNlToSqlPrompt: true`, `ask()` "strips
   * sensitive table/column names from the NL→SQL DDL entirely" (`reference/core-api.mdx`).
   * The same call without it is the control: the columns are there, tagged.
   * Catches: the option ignored, or omission that drops the whole table instead of its
   * sensitive columns.
   * Not covered elsewhere: core's tests, on workspace source, in-process.
   */
  describe("sensitive-omit-library", () => {
    it("sensitive-omit-library: ask() with omitSensitiveIdentifiersFromNlToSqlPrompt sends a prompt without email and ssn", async (ctx) => {
      needsSensitiveCapabilities(ctx, dialect);

      const omitted = await promptOf(dialect, CONTROL, () => ask(dialect, CONTROL, { omitSensitiveIdentifiersFromNlToSqlPrompt: true }));
      const control = await promptOf(dialect, CONTROL, () => ask(dialect, CONTROL));

      expectOmitted(omitted);
      expectTagged(control);
    });
  });

  /**
   * Contract: in the default `sensitiveGuardrailMode: "warn"`, `ask()` returns the SQL and
   * attaches `sensitiveGuardrail`, "the sensitive identifiers the returned SQL references",
   * with `passed: false` (`reference/core-api.mdx`, "Result", `validateSensitiveReferences`).
   * Each `SensitiveReference` names the table, schema, column and `matchKind`: `qualified`
   * for `alias.column`, `unqualified` for a bare column. The reference counts wherever the
   * column is read, a `WHERE` filter included, and whatever quoting the dialect uses (the
   * lexer is dialect-aware: `docs/contracts/sensitive-fields-and-modes.md`, "Lexing"). The
   * guardrail runs whatever the prompt showed: with omission on, a reply that reads `ssn` is
   * still flagged ("regardless of whether the names were tagged, omitted, or never shown to
   * a model at all"). Run as the host, each flagged reply returns the seeded values it reads,
   * and the control reply, which reads no sensitive column, passes and returns none.
   * Catches: a heuristic that misses a shape (a bare, aliased, filter-only or quoted
   * reference) on one dialect; warn mode that throws or drops the SQL; references with the
   * wrong column or `matchKind`; a guardrail skipped when omission is on; and a false
   * positive on the control.
   * Not covered elsewhere: core's guardrail tests lex strings on workspace source; the CLI
   * suite's `cli-ask-sensitive-warning` reads only the CLI's stderr, on Postgres, for one
   * bare column; neither runs a reply to show what it reads on an engine.
   */
  describe("sensitive-warn", () => {
    it.for(COLUMN_READS.map((r) => [r.id, r] as const))("sensitive-warn: %s, which reads a sensitive column, is returned and flagged", async ([, reading], ctx) => {
      needsSensitiveCapabilities(ctx, dialect);
      await expectWarned(dialect, reading);
    });

    it(`sensitive-warn: ${CONTROL}, which reads no sensitive column, passes with no references and returns no sensitive value`, async (ctx) => {
      needsSensitiveCapabilities(ctx, dialect);

      const result = await ask(dialect, CONTROL);

      expect(result.sql).toBe(cassetteSql(dialect, CONTROL, QUESTIONS));
      // Present only when the schema marks something sensitive: the overlay was loaded.
      expect(result.sensitiveGuardrail, "no sensitiveGuardrail: the schema has no sensitive marker").toEqual({ passed: true, references: [] });
      expect(await seededValuesReturned(dialect, result.sql)).toEqual(allSeededValuesOf([]));
    });

    it("sensitive-warn: with omission on, a reply that reads ssn is still flagged", async (ctx) => {
      needsSensitiveCapabilities(ctx, dialect);
      const id = "sensitive-client-ssns";
      let result!: AskResult;

      const prompt = await promptOf(dialect, id, async () => (result = await ask(dialect, id, { omitSensitiveIdentifiersFromNlToSqlPrompt: true })));

      // The model was never shown ssn, and named it anyway.
      expect(prompt).not.toMatch(names("ssn"));
      expect(result.sensitiveGuardrail).toMatchObject({ passed: false });
      expect(sorted(result.sensitiveGuardrail?.references)).toEqual(expectedReferences(dialect, [["ssn", "unqualified"]]));
    });
  });

  /**
   * Contract: with `sensitiveGuardrailMode: "strict"`, `ask()` "throws
   * `SensitiveReferenceError`" (`reference/core-api.mdx`) whenever `passed` would be
   * `false`, carrying `.rule` `SENSITIVE_COLUMN_REFERENCED` for a sensitive column and
   * `.references` (`docs/contracts/sensitive-fields-and-modes.md`, "Modes"). The model is
   * called, and the SQL it wrote is never returned. The control reply is returned, with a
   * passing guardrail.
   * Catches: strict mode that only warns (returns the SQL that reads the data), rejects
   * under another rule, drops the references, or rejects SQL that reads no sensitive column.
   * Not covered elsewhere: core's tests, on workspace source, never with a model reply over
   * HTTP or on each dialect's quoting.
   */
  describe("sensitive-strict", () => {
    it.for(COLUMN_READS.map((r) => [r.id, r] as const))(
      "sensitive-strict: %s, which reads a sensitive column, is rejected with SensitiveReferenceError SENSITIVE_COLUMN_REFERENCED",
      async ([, reading], ctx) => {
        needsSensitiveCapabilities(ctx, dialect);
        await expectRejected(dialect, reading);
      },
    );

    it(`sensitive-strict: ${CONTROL}, which reads no sensitive column, is returned`, async (ctx) => {
      needsSensitiveCapabilities(ctx, dialect);

      const result = await ask(dialect, CONTROL, { sensitiveGuardrailMode: "strict" });

      expect(result.sql).toBe(cassetteSql(dialect, CONTROL, QUESTIONS));
      expect(result.sensitiveGuardrail).toEqual({ passed: true, references: [] });
    });
  });

  /**
   * Contract: `SELECT *` and `alias.*` "reach every column of that table, so they are
   * reported as referencing each of its sensitive columns": `SELECT *` as `unqualified`,
   * `alias.*` as `qualified` (`docs/contracts/sensitive-fields-and-modes.md`, "Wildcards and
   * whole rows"; `reference/core-api.mdx`, `SensitiveReference`). So warn mode flags them with
   * both columns and strict mode rejects them, as for a named column. Run as the host, each
   * returns the seeded emails and SSNs it reaches.
   * Catches: a wildcard read as naming no column (the reply returns the data and passes);
   * `alias.*` not resolved through its alias on a join; either expanded to the wrong columns.
   * Not covered elsewhere: `sensitive-warn` and `sensitive-strict` name each column; core's
   * tests, on workspace source, never run the reply. A scenario of its own, because targets
   * from before the expansion lack the capability (`sensitive-wildcards`), and a gated test
   * would hide its passing siblings behind `n/a` in a shared cell.
   */
  describe("sensitive-wildcard", () => {
    it.for(WILDCARD_READS.map((r) => [r.id, r] as const))("sensitive-wildcard: %s, in warn mode, is returned and flagged with every sensitive column", async ([, reading], ctx) => {
      needsSensitiveCapabilities(ctx, dialect);
      await needsCapability(ctx, "sensitive-wildcards");
      await expectWarned(dialect, reading);
    });

    it.for(WILDCARD_READS.map((r) => [r.id, r] as const))(
      "sensitive-wildcard: %s, in strict mode, is rejected with SensitiveReferenceError SENSITIVE_COLUMN_REFERENCED",
      async ([, reading], ctx) => {
        needsSensitiveCapabilities(ctx, dialect);
        await needsCapability(ctx, "sensitive-wildcards");
        await expectRejected(dialect, reading);
      },
    );
  });
});

// --- The other omission surfaces. Each forwards a switch to the same prompt formatting, so
// --- they are engine-independent and run once, as `[postgres]`.

/**
 * Contract: `createAskDb().ask(question, overrides)` takes `omitSensitiveIdentifiersFromNlToSqlPrompt`
 * per call ("Strip sensitive identifiers from the DDL prompt", `reference/client-api.mdx`,
 * "Overrides"). The same call without it is the control.
 * Catches: `@askdb/client` not forwarding the override to the pipeline.
 * Not covered elsewhere: `sensitive-omit-library` calls `ask()` from `@askdb/core` directly;
 * the client's unit tests mock the pipeline.
 */
describe("[postgres] sensitive-omit-client", () => {
  it("sensitive-omit-client: createAskDb().ask() with the omitSensitiveIdentifiersFromNlToSqlPrompt override sends a prompt without email and ssn", async (ctx) => {
    needsSensitiveCapabilities(ctx, "postgres");
    bootstrapAskDbEnv({ cwd: LAB_ROOT });
    const askdb = createAskDb({ config: getAskDbRuntimeConfig(), providers: [openaiProvider], schema: { path: artifact("postgres") } });
    // The documented per-call `model` override, pointed at the replay server.
    const model = createOpenAI({ baseURL: replay.baseURL("postgres"), apiKey: API_KEY })(MODEL_ID);
    const text = question(CONTROL).text;

    const omitted = await promptOf("postgres", CONTROL, () => askdb.ask(text, { model, omitSensitiveIdentifiersFromNlToSqlPrompt: true }));
    const control = await promptOf("postgres", CONTROL, () => askdb.ask(text, { model }));

    expectOmitted(omitted);
    expectTagged(control);
  });
});

/** The installed `askdb ask` for the control question, with the model from the project's config pointed at the replay server. */
function cliAsk(args: string[] = [], options: { cwd?: string; env?: Record<string, string> } = {}) {
  return askdbAsync(["ask", "--schema", artifact("postgres"), "--question", question(CONTROL).text, ...args], {
    cwd: options.cwd,
    env: { LAB_REPLAY_BASE_URL: replay.baseURL("postgres"), ...options.env },
  });
}

/**
 * Contract: `askdb ask --omit-sensitive-from-prompt` "Exclude[s] sensitive columns from the
 * prompt entirely" (`reference/cli.mdx`, `askdb ask`). The same command without it is the
 * control.
 * Catches: the packed CLI not forwarding the flag, or forwarding it only to part of the
 * prompt.
 * Not covered elsewhere: `apps/cli`'s tests run the workspace build with `--mock-sql`, which
 * sends no prompt; the lab's CLI suite never passes the flag.
 */
describe("[postgres] sensitive-omit-cli", () => {
  it("sensitive-omit-cli: askdb ask --omit-sensitive-from-prompt sends a prompt without email and ssn", async (ctx) => {
    needsSensitiveCapabilities(ctx, "postgres");

    const omitted = await promptOf("postgres", CONTROL, async () => expect((await cliAsk(["--omit-sensitive-from-prompt"])).status).toBe(0));
    const control = await promptOf("postgres", CONTROL, async () => expect((await cliAsk()).status).toBe(0));

    expectOmitted(omitted);
    expectTagged(control);
  });
});

/**
 * `askdb-http` on the Postgres artifact with the overlay, from `cwd`'s config (default: the
 * lab's), one per key, started on first use and killed in afterAll.
 */
function sensitiveHttpServer(key: string, cwd?: string): Promise<HttpServer> {
  if (!httpServers.has(key)) {
    httpServers.set(key, startHttpServer({ cwd, schemaPath: artifact("postgres"), env: { LAB_REPLAY_BASE_URL: replay.baseURL("postgres") } }));
  }
  return httpServers.get(key)!;
}

/**
 * Contract: `POST /ask` takes `omitSensitiveFromPrompt` ("Omit sensitive columns from the
 * prompt", `reference/http-api.mdx`, "POST /ask"). The same request without it is the
 * control.
 * Catches: the packed server not forwarding the field (the transport dropping it).
 * Not covered elsewhere: `apps/http-api`'s tests run workspace source in-process; the lab's
 * HTTP suite never sends the field or reads a prompt for it.
 */
describe("[postgres] sensitive-omit-http", () => {
  it("sensitive-omit-http: POST /ask with omitSensitiveFromPrompt: true sends a prompt without email and ssn", async (ctx) => {
    needsSensitiveCapabilities(ctx, "postgres");
    const http = await sensitiveHttpServer("lab");
    const text = question(CONTROL).text;

    const omitted = await promptOf("postgres", CONTROL, async () => expect((await postAsk(http, { question: text, omitSensitiveFromPrompt: true })).status).toBe(200));
    const control = await promptOf("postgres", CONTROL, async () => expect((await postAsk(http, { question: text })).status).toBe(200));

    expectOmitted(omitted);
    expectTagged(control);
  });
});

/**
 * A project directory whose `askdb.config.ts` is the lab's (the replay model) plus
 * `modes.omitSensitiveFromPrompt: true`, the config switch `reference/config.mdx` ("`modes`
 * and `host`") and `guides/run-safely-in-prod.mdx` ("Sensitive columns") document.
 */
function omitConfigProject(): string {
  const project = join(scratch, "omit-config");
  mkdirSync(project, { recursive: true });
  writeFileSync(
    join(project, "askdb.config.ts"),
    `import { defineConfig, env } from "@askdb/config";

export default defineConfig({
  ai: {
    provider: "openai",
    providerConfig: { openai: { apiKey: "${API_KEY}", baseUrl: env("LAB_REPLAY_BASE_URL"), model: "${MODEL_ID}" } },
  },
  introspection: { provider: "postgres", providerConfig: { postgres: {} } },
  modes: { omitSensitiveFromPrompt: true },
  rag: { embedder: "mock", embedderConfig: {}, store: "memory", storeConfig: { memory: {} } },
});
`,
  );
  return project;
}

/**
 * The body of an `it.fails` omission case. It must fail only because the prompt still names
 * the sensitive columns. Anything else, a failed request or no model call, makes the body
 * pass, so `it.fails` reports the cell as `FAIL`, not as the known issue.
 */
async function expectOmittedKnown(run: () => Promise<boolean>): Promise<void> {
  let ok = false;
  const calls = await callsOf(async () => (ok = await run()));
  const call = calls.length === 1 && calls[0]!.questionId === CONTROL && calls[0]!.error === null ? calls[0] : undefined;
  if (!ok || !call) {
    console.error("not the known discrepancy: the request failed, or it didn't make exactly one answered model call", calls);
    return;
  }
  expectOmitted(call.prompt);
}

/**
 * Contract: `modes.omitSensitiveFromPrompt: true` in `askdb.config.ts` omits sensitive
 * columns from the prompt (`guides/run-safely-in-prod.mdx`: "set
 * `modes.omitSensitiveFromPrompt: true` in `askdb.config.ts` (or pass
 * `--omit-sensitive-from-prompt`)"; `concepts/modes-and-dialects.mdx`), and over HTTP it is
 * the request field's default (`reference/http-api.mdx`: `omitSensitiveFromPrompt`, default
 * "env-driven"). The CLI honors it. `askdb-http` ignores it: a request without the field is
 * sent the sensitive columns, tagged (#376).
 * Catches: a deployment that sets the documented config switch and still sends the model its
 * sensitive column names, through the CLI or the HTTP API.
 * Not covered elsewhere: `sensitive-omit-cli` and `sensitive-omit-http` pass the switch per
 * call; nothing starts a surface from a config that sets it.
 */
describe("[postgres] sensitive-omit-config", () => {
  it("sensitive-omit-config: askdb ask from a config with modes.omitSensitiveFromPrompt sends a prompt without email and ssn", async (ctx) => {
    needsSensitiveCapabilities(ctx, "postgres");

    const prompt = await promptOf("postgres", CONTROL, async () => expect((await cliAsk([], { cwd: omitConfigProject() })).status).toBe(0));

    expectOmitted(prompt);
  });

  it.fails("sensitive-omit-config: POST /ask without omitSensitiveFromPrompt, on a server whose config sets modes.omitSensitiveFromPrompt, sends a prompt without email and ssn (#376)", async (ctx) => {
    needsSensitiveCapabilities(ctx, "postgres");
    const http = await sensitiveHttpServer("omit-config", omitConfigProject());

    await expectOmittedKnown(async () => (await postAsk(http, { question: question(CONTROL).text })).status === 200);
  });
});

/**
 * Contract: `docs/contracts/sensitive-fields-and-modes.md` ("Current behavior") names three
 * ways to omit: `omitSensitiveIdentifiersFromNlToSqlPrompt`, `--omit-sensitive-from-prompt`,
 * and `ASKDB_OMIT_SENSITIVE_FROM_PROMPT`. The variable is a flat key AskDB builds from
 * `askdb.config.ts`, never read from `process.env`, so setting it in the environment omits
 * nothing (#377; the same class of doc error as #282).
 * Catches: an operator who sets the documented variable and still sends the model its
 * sensitive column names.
 * Not covered elsewhere: no other test sets the variable.
 */
describe("[postgres] sensitive-omit-env", () => {
  it.fails("sensitive-omit-env: askdb ask with ASKDB_OMIT_SENSITIVE_FROM_PROMPT=true sends a prompt without email and ssn (#377)", async (ctx) => {
    needsSensitiveCapabilities(ctx, "postgres");

    await expectOmittedKnown(async () => (await cliAsk([], { env: { ASKDB_OMIT_SENSITIVE_FROM_PROMPT: "true" } })).status === 0);
  });
});
