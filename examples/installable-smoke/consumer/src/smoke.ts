/**
 * End-to-end install smoke test for AskDB.
 *
 * Imports `ask` from `@askdb/core`, the engine-agnostic
 * `introspect()` from `@askdb/introspect`, and the Postgres dialect + connector
 * from `@askdb/postgres`, plus the Prisma connector from `@askdb/prisma`.
 * Runs the pipeline against a fake LanguageModel and confirms generated SQL is
 * returned without any execution seam in core.
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
import {
  createAiRegistry,
  openaiProvider,
  optionalPeerMissingMessage,
  type AiRegistry,
} from "@askdb/ai";
import { openaiProvider as deprecatedShimOpenaiProvider } from "@askdb/ai-openai";
import { buildSchemaIndex, createMemoryStore, type Embedder } from "@askdb/rag";
import { createFileStore } from "@askdb/rag/stores/file";
import { buildDefaultTableBody, replaceH2Section } from "@askdb/enrich";
import { introspect, renderToSchemaV2, type CatalogQueryRunner } from "@askdb/introspect";
import { compileTableFilters, createOptionalDriverLoader, makeTableId } from "@askdb/introspect/kit";
import {
  createPostgresConnector,
  postgresDialect,
  type PostgresIntrospectionInput,
} from "@askdb/postgres";
import { createPrismaConnector } from "@askdb/prisma";

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

  // Verify @askdb/postgres re-exports the DialectSpec from @askdb/core.
  if (postgresDialect.id !== "postgres") {
    throw new Error("smoke: postgresDialect.id is not 'postgres'");
  }
  if (typeof postgresDialect.promptBrief !== "string" || postgresDialect.promptBrief.length === 0) {
    throw new Error("smoke: postgresDialect.promptBrief is missing");
  }
  // Smoke a string-id dialect through ask().
  const stringIdOut = await ask({
    question: "How many users are there?",
    schema,
    model: {} as never,
    dialect: "postgres",
    deps: { generateText: (async () => ({ text: `\`\`\`sql\n${fakeSql}\n\`\`\`` } as never)) as never },
  });
  if (stringIdOut.sql !== fakeSql) {
    throw new Error(`smoke: dialect:"postgres" produced ${JSON.stringify(stringIdOut.sql)}`);
  }
  const connector = createPostgresConnector();
  const templates = connector.templates!();
  if (templates.engine !== "postgres" || templates.templates.length === 0) {
    throw new Error("smoke: @askdb/postgres connector templates did not load");
  }
  const prismaConnector = createPrismaConnector();
  if (typeof prismaConnector.describe !== "function") {
    throw new Error("smoke: @askdb/prisma connector did not load");
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
  // Verify the @askdb/introspect/kit subpath resolves from an ESM consumer.
  if (
    makeTableId("public", "users") !== "table:public.users" ||
    !compileTableFilters(["public.*"])("public.users") ||
    typeof createOptionalDriverLoader !== "function"
  ) {
    throw new Error("smoke: @askdb/introspect/kit did not load");
  }

  const tableBody = replaceH2Section(
    buildDefaultTableBody("users", "Application users."),
    "Common query language",
    "active users = users with recent sign-ins",
  );
  if (!tableBody.includes("## Common query language")) {
    throw new Error("smoke: @askdb/enrich helpers did not update table body");
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

  // Verify the sub-path export resolves to the same factory (both import styles must work).
  if (typeof createFileStore !== "function") {
    throw new Error("smoke: @askdb/rag/stores/file sub-path export did not resolve");
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

  // Verify @askdb/ai exports the canonical (non-prefixed) names. "openai" is a
  // built-in provider; this consumer installs its optional peer @ai-sdk/openai.
  const aiRegistry: AiRegistry = createAiRegistry(["openai"]);
  if (typeof aiRegistry.createLanguageModelFromEnv !== "function") {
    throw new Error("smoke: @askdb/ai createAiRegistry did not return a registry with createLanguageModelFromEnv");
  }
  if (typeof aiRegistry.createEmbeddingModelFromEnv !== "function") {
    throw new Error("smoke: @askdb/ai createAiRegistry did not return a registry with createEmbeddingModelFromEnv");
  }
  const openaiModel = await aiRegistry.createLanguageModel({
    provider: "openai",
    apiKey: "smoke-key",
    model: "gpt-4o-mini",
  });
  if (typeof openaiModel !== "object" || openaiModel === null) {
    throw new Error("smoke: @askdb/ai did not lazily load the installed @ai-sdk/openai peer");
  }

  // @ai-sdk/google is NOT installed here: the built-in google provider must fail
  // at model-creation time with an actionable install message, not a raw
  // module-resolution error (and registering it must cost nothing).
  const allBuiltins = createAiRegistry();
  if (!allBuiltins.hasProvider("google") || !allBuiltins.hasProvider("foundry")) {
    throw new Error("smoke: createAiRegistry() did not register the built-in providers");
  }
  const missingPeerError = await allBuiltins
    .createLanguageModel({ provider: "google", apiKey: "smoke-key", model: "gemini-2.0-flash" })
    .then(
      () => undefined,
      (e: unknown) => e,
    );
  const expectedMissingPeer = optionalPeerMissingMessage("google", "@ai-sdk/google");
  if (!(missingPeerError instanceof Error) || missingPeerError.message !== expectedMissingPeer) {
    throw new Error(
      `smoke: expected "${expectedMissingPeer}" for a missing optional peer, got: ${String(missingPeerError)}`,
    );
  }

  // The deprecated @askdb/ai-openai shim must keep re-exporting the adapter.
  if (deprecatedShimOpenaiProvider !== openaiProvider) {
    throw new Error("smoke: @askdb/ai-openai shim does not re-export @askdb/ai's openaiProvider");
  }

  console.log("smoke: ok - core, introspect, postgres, prisma, enrich, rag, and ai package surfaces loaded");
}

main().catch((e: unknown) => {
  console.error("smoke: FAILED");
  console.error(e);
  process.exit(1);
});
