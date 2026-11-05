/**
 * Question → SQL → execute: every catalog question, on every engine, checked against an
 * oracle computed from the seed data.
 *
 * Protects: packed AskDB passes a correct model reply through to `result.sql` without
 * corrupting it (`reference/core-api.mdx`, "Result — AskPipelineResult": `sql` is "the
 * model's bound, validated SQL"): extraction, validation and parameter binding keep a
 * statement that returns the right rows. And the lab, as the host, gets the right answer by
 * running it the way `guides/run-safely-in-prod` says (the read-only role, a statement
 * timeout, a row cap). The replies are hand-written (`"source": "authored"`), so whether a
 * reply is correct SQL for its dialect is the cassette author's job, checked here too; how
 * well a real model writes SQL is not under test (#247). Why the expected rows come from
 * an oracle rather than from running SQL: the lab README, "Why the expected answer never
 * comes from SQL". For each question the rows,
 * normalized by `fixtures/multi-engine/dataset/NORMALIZATION.md`, equal the oracle in
 * `src/oracle.ts`, which computes the answer in TypeScript from
 * `fixtures/multi-engine/dataset/data/*.json` and never runs SQL. Five engines equal to one
 * oracle agree with each other, so cross-dialect equivalence needs no test of its own. The
 * parameterized question also checks the parameterized output contract: `unboundSql` +
 * `params` bound by the engine's real driver, and `bindPreparedQuery`'s rebound forms,
 * return the same rows as the inline SQL.
 * Catches: a packed `@askdb/core` whose extraction or validation mangles valid dialect SQL
 * (quoted reserved words, `N'…'` strings, `TOP`, `OFFSET … FETCH`, composite join
 * conditions) so that it still runs but returns other rows, or no longer runs; driver
 * markers (`$N`, `?`, `@pN`) a driver can't bind, or bound to the wrong values; and a
 * cassette that doesn't answer its question on one dialect.
 * Not covered elsewhere: `lab-ask-replay` checks that both model paths return the
 * cassette's SQL and that it runs, but never what the rows are; core's unit tests use
 * workspace source and run no SQL; the fixture's own test reads tables back but never
 * through AskDB.
 * No production seam: `ask()` gets a raw `LanguageModel` pointed at the replay server (the
 * documented bring-your-own-model path); `bindPreparedQuery` is a documented export.
 *
 * The scenario id is the question id, so `pnpm lab:matrix` shows one row per question.
 *
 * Needs the `cli-introspect-engine` capability to build the schema artifacts, the fixture
 * (`pnpm fixture:up`) and an installed lab (`pnpm lab:use .`).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { askRaw, type AskResult } from "../src/ask.js";
import { ensureArtifact } from "../src/artifacts.js";
import { needsCapability } from "../src/capabilities.js";
import { SUPPORTED_DIALECTS, type SupportedDialect } from "../src/dialects.js";
import { normalizeRows } from "../src/fixture.js";
import { rebind } from "../src/grade.js";
import { executeReadOnly } from "../src/host/execute.js";
import { loadQuestions, type Question } from "../src/model/catalog.js";
import { startReplayServer, type ReplayServer } from "../src/model/replay-server.js";
import { ORACLES, PARAMETERIZED, type Oracle } from "../src/oracle.js";

const QUESTIONS = loadQuestions();

let replay: ReplayServer;

beforeAll(async () => {
  replay = await startReplayServer();
});

afterAll(async () => {
  await replay?.close();
});

function oracleOf(id: string): Oracle {
  const oracle = ORACLES[id];
  if (!oracle) throw new Error(`catalog question ${id} has no oracle: add its expected answer to examples/consumer-lab/src/oracle.ts`);
  return oracle;
}

/** Rows run as the read-only role, all of them: the row cap must not have cut the answer. */
async function run(dialect: SupportedDialect, sql: string, params?: readonly unknown[]): Promise<unknown[][]> {
  const result = await executeReadOnly(dialect, sql, { params });
  expect(result.truncated, "the host's row cap cut the result").toBe(false);
  return result.rows;
}

describe.each(SUPPORTED_DIALECTS.map((d) => [d] as [SupportedDialect]))("[%s]", (dialect) => {
  const answers = new Map<string, Promise<AskResult>>();

  /** `ask()`'s result for a catalog question, asked once per dialect. */
  function answer(question: Question): Promise<AskResult> {
    if (!answers.has(question.id)) {
      answers.set(question.id, askRaw(dialect, question.text, ensureArtifact(dialect), replay.baseURL(dialect)));
    }
    return answers.get(question.id)!;
  }

  it.for(QUESTIONS.map((q) => [q.id, q] as const))("%s: the SQL ask() returns, run as the read-only role, returns the oracle's rows", async ([, question], ctx) => {
    needsCapability(ctx, "cli-introspect-engine");
    const oracle = oracleOf(question.id);
    const { sql } = await answer(question);

    const got = normalizeRows(await run(dialect, sql), oracle.types, { ordered: oracle.ordered });

    expect(got).toEqual(normalizeRows(oracle.rows(), oracle.types, { ordered: oracle.ordered }));
  });

  // The parameterized output contract, on the catalog's parameterized question.
  const asked = QUESTIONS.find((q) => q.id === PARAMETERIZED.id)!;
  const paramOracle = oracleOf(PARAMETERIZED.id);
  const expected = (rows: unknown[][]) => normalizeRows(rows, paramOracle.types, { ordered: paramOracle.ordered });
  const actual = async (sql: string, params?: readonly unknown[]) => expected(await run(dialect, sql, params));

  it(`${PARAMETERIZED.id}: unboundSql + params, bound by the driver, return the same rows as the inline sql`, async (ctx) => {
    needsCapability(ctx, "cli-introspect-engine");
    const result = await answer(asked);

    expect(result.unboundSql, "ask() returned no unboundSql for a reply with a sql-unbound block and a manifest").toBeDefined();
    // A statement that still holds the literal would bind nothing: the check below would pass vacuously.
    expect(result.unboundSql).not.toContain(PARAMETERIZED.value);
    expect(result.params).toHaveLength(1);
    expect(await actual(result.unboundSql!, result.params)).toEqual(expected(paramOracle.rows()));
    expect(await actual(result.sql)).toEqual(expected(paramOracle.rows()));
  });

  it(`${PARAMETERIZED.id}: bindPreparedQuery rebinds the value, and its sql and its unboundSql + params both return the new value's rows`, async (ctx) => {
    needsCapability(ctx, "cli-introspect-engine");
    const result = await answer(asked);
    expect(result.preparedQuery, "ask() returned no preparedQuery for a reply with a sql-unbound block and a manifest").toBeDefined();

    // The placeholder's name is the reply's: `start_date` in an authored reply, the model's choice in a recorded one.
    const name = result.parameters?.[0]?.name;
    expect(name, "ask() returned no named parameter binding for a reply with a manifest").toBeDefined();
    const rebound = rebind(dialect, result.preparedQuery!, { [name!]: PARAMETERIZED.rebindTo });
    const want = expected(PARAMETERIZED.rows(PARAMETERIZED.rebindTo));

    // The new value must change the answer, or this couldn't tell a rebind from the original.
    expect(want).not.toEqual(expected(paramOracle.rows()));
    expect(await actual(rebound.sql)).toEqual(want);
    expect(await actual(rebound.unboundSql, rebound.params)).toEqual(want);
  });
});
