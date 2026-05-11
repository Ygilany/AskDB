/**
 * End-to-end install smoke test for AskDB.
 *
 * Imports `ask` from `@askdb/core`, the engine-agnostic
 * `introspect()` from `@askdb/introspect`, and the Postgres dialect + connector
 * from `@askdb/postgres`. Runs the pipeline against a fake LanguageModel and
 * confirms generated SQL is returned without any execution seam in core.
 *
 * Crucially, this consumer does NOT install `pg` — the test verifies the optional-peer story.
 */
import {
  ask,
  loadNormalizedSchemaFromJson,
  loadSchemaFromJson,
  type AskDbSchemaFile,
  type AskDialect,
} from "@askdb/core";
import { buildSchemaIndex, type Embedder } from "@askdb/rag";
import { createMemoryStore } from "@askdb/rag/stores/memory";
import { introspect, renderToSchemaV2, type CatalogQueryRunner } from "@askdb/introspect";
import {
  createPostgresConnector,
  postgresDialect,
  type PostgresIntrospectionInput,
} from "@askdb/postgres";

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

const catalogRunner: CatalogQueryRunner = async (sql) => {
  if (typeof sql !== "string" || sql.length === 0) {
    throw new Error("smoke: catalog runner received empty SQL");
  }
  return { columns: [], rows: [] };
};

// Stub dialect — bypasses the live model entirely.
const fakeDialect: AskDialect = {
  async generate() {
    return { sql: fakeSql };
  },
};

const v2SchemaJson = JSON.stringify({
  version: 2,
  schemaId: "smoke",
  tables: [
    {
      id: "table:public.users",
      name: "users",
      schema: "public",
      columns: [
        {
          id: "table:public.users#id",
          name: "id",
          type: "uuid",
          nullable: false,
          primaryKey: true,
        },
      ],
    },
  ],
});

const fakeEmbedder: Embedder = async (texts) => texts.map((text) => [text.length, 1]);

async function main(): Promise<void> {
  const schema = loadNormalizedSchemaFromJson(JSON.stringify(schemaJson));

  // Verify ask() works with a fake dialect and no execution seam.
  const out = await ask({
    question: "How many users are there?",
    schema,
    model: {} as never,
    dialect: fakeDialect,
  });

  if (out.sql !== fakeSql) {
    throw new Error(`smoke: expected sql ${JSON.stringify(fakeSql)}, got ${JSON.stringify(out.sql)}`);
  }

  // Verify @askdb/postgres exports the expected surface.
  if (typeof postgresDialect.generate !== "function") {
    throw new Error("smoke: postgresDialect.generate is not a function");
  }
  const connector = createPostgresConnector();
  const templates = connector.templates!();
  if (templates.engine !== "postgres" || templates.templates.length === 0) {
    throw new Error("smoke: @askdb/postgres connector templates did not load");
  }

  // Verify the connector input type narrows.
  const input: PostgresIntrospectionInput = { mode: "live", runner: catalogRunner };
  if (input.mode !== "live") {
    throw new Error("smoke: PostgresIntrospectionInput type did not narrow");
  }

  // Verify @askdb/introspect public functions are reachable.
  if (typeof introspect !== "function" || typeof renderToSchemaV2 !== "function") {
    throw new Error("smoke: @askdb/introspect public functions did not load");
  }

  const v2Schema = loadSchemaFromJson(v2SchemaJson);
  const index = await buildSchemaIndex({
    schema: v2Schema,
    embedder: fakeEmbedder,
    store: createMemoryStore(),
    embedderId: "smoke:fake",
  });
  if (index.stats.chunksTotal === 0 || typeof index.retriever !== "function") {
    throw new Error("smoke: @askdb/rag did not build an in-memory index");
  }

  const ragOut = await ask({
    question: "How many users are there?",
    schema: v2Schema,
    model: {} as never,
    dialect: fakeDialect,
    retriever: index.retriever,
    totalSchemaChunkCount: index.stats.chunksTotal,
    retrievalThresholdChunks: 0,
  });
  if (ragOut.sql !== fakeSql) {
    throw new Error("smoke: ask({ retriever }) did not complete");
  }

  console.log("smoke: ok - core, introspect, postgres, and rag package surfaces loaded");
}

main().catch((e: unknown) => {
  console.error("smoke: FAILED");
  console.error(e);
  process.exit(1);
});
