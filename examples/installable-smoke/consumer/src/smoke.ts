/**
 * End-to-end install smoke test for `@askdb/core` (Phase 4 Group 4).
 *
 * Imports `ask` and the executor seam types from the *installed* package, runs the pipeline
 * against a fake LanguageModel (via `deps.generateText`) and a fake `AskDbExecutor`, and asserts
 * the executor's canned `TabularResult` round-trips back through `ask()`.
 *
 * Crucially, this consumer does NOT install `pg` — the test verifies the optional-peer story.
 */
import {
  ask,
  loadNormalizedSchemaFromJson,
  type AskDbExecutor,
  type AskDbSchemaFile,
  type TabularResult,
} from "@askdb/core";

const schemaJson: AskDbSchemaFile = {
  version: 1,
  tables: [
    {
      name: "users",
      columns: [
        { name: "id", type: "uuid", nullable: false, primaryKey: true },
        { name: "email", type: "text", nullable: false },
      ],
    },
  ],
};

const fakeSql = "SELECT COUNT(*)::int AS n FROM users";

const fakeResult: TabularResult = {
  columns: ["n"],
  rows: [[42]],
};

const executor: AskDbExecutor = async (sql) => {
  if (typeof sql !== "string" || sql.length === 0) {
    throw new Error("smoke: executor received empty SQL");
  }
  return fakeResult;
};

// AI SDK's `generateText` has a wide return shape; the pipeline only reads `.text`. Cast through
// `unknown` to keep the smoke test self-contained (no AI SDK dependency in the consumer).
const fakeGenerateText = (async () => ({ text: fakeSql })) as unknown as Parameters<
  typeof ask
>[0]["deps"] extends infer D
  ? D extends { generateText?: infer F }
    ? NonNullable<F>
    : never
  : never;

async function main(): Promise<void> {
  const schema = loadNormalizedSchemaFromJson(JSON.stringify(schemaJson));

  const out = await ask({
    question: "How many users are there?",
    schema,
    // Model is forwarded into `deps.generateText`, which we override — the value is unused.
    model: {} as never,
    executor,
    execute: true,
    deps: { generateText: fakeGenerateText },
  });

  if (out.sql !== fakeSql) {
    throw new Error(`smoke: expected sql ${JSON.stringify(fakeSql)}, got ${JSON.stringify(out.sql)}`);
  }
  if (!out.result || out.result.rows.length !== 1 || out.result.rows[0]![0] !== 42) {
    throw new Error(`smoke: executor result did not round-trip: ${JSON.stringify(out.result)}`);
  }
  console.log("smoke: ok — sql + executor result round-tripped through @askdb/core");
}

main().catch((e: unknown) => {
  console.error("smoke: FAILED");
  console.error(e);
  process.exit(1);
});
