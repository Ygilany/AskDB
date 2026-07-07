/**
 * AskDB — "ask a question" example
 *
 * Shows two ways to call AskDB:
 *   Fast path — @askdb/client facade: only the question is needed per call.
 *               Schema, model, and dialect are resolved from config.
 *   Direct    — @askdb/core ask(): BYO model, full control.
 *
 * Then a third variant shows the direct path combined with RAG:
 *   With RAG  — a vector index narrows the schema context before calling
 *               the model. Better accuracy and lower token cost for large schemas.
 *
 * Configuration lives in askdb.config.ts (this directory). Copy .env.example
 * to .env and fill in your API key before running.
 *
 * Run with:
 *   bun main.ts
 *   npx tsx main.ts
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
import { createAiRegistry } from "@askdb/ai";
import { openaiProvider } from "@askdb/ai-openai";
import { createAskDb } from "@askdb/client";
import {
  ask,
  loadSchema,
} from "@askdb/core";
import { buildSchemaIndex, createMemoryStore, createAiSdkEmbedder } from "@askdb/rag";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Registry built manually only for the advanced direct-ask() path below;
// the fast path passes `providers` to createAskDb instead.
const ai = createAiRegistry([openaiProvider]);

// Load .env (if present) and evaluate askdb.config.ts in this directory,
// installing the AskDB runtime snapshot used by all subsequent calls.
bootstrapAskDbEnv({ cwd: __dirname });
const runtimeConfig = getAskDbRuntimeConfig();

// Point this at your own <schema-id>.schema/ directory.
// Here we reuse the fixture schema that ships with this repo.
const SCHEMA_DIR = path.resolve(
  __dirname,
  "../../fixtures/schemas/orders-users.schema",
);

const QUESTIONS = [
  "How much revenue did we make last month?",
  "Which customers placed the most orders?",
  "How many users signed up in the last 7 days?",
];

async function main(): Promise<void> {
  // ── Load schema ─────────────────────────────────────────────────────────────
  //
  // loadSchema accepts a .schema/ directory, a bundled JSON file, or a bare
  // schema.json path. It merges the physical layer (schema.json) with the
  // enrichment layer (tables/*.md, concepts.md) into a single normalized object.
  const schema = loadSchema(SCHEMA_DIR);

  console.log(`\nSchema: ${schema.schemaId} (${schema.tables.length} tables)`);
  for (const table of schema.tables) {
    console.log(`  · ${table.schema}.${table.name} — ${table.columns.length} columns`);
  }

  // ── Fast path — createAskDb resolves schema, model, and dialect from config ─
  //
  // Schema comes from the `schema` option (or host.schemaPath in askdb.config.ts);
  // the model comes from the AI registry; the dialect is inferred from config.
  // You only pass the question per call.
  console.log(
    "\n── Fast path (@askdb/client — schema, model, dialect resolved from config) ─",
  );

  const askdb = createAskDb({
    config: runtimeConfig,
    providers: [openaiProvider], // adapters only — the client builds the registry
    schema: { path: SCHEMA_DIR }, // or set host.schemaPath in askdb.config.ts and omit this
  });

  try {
    for (const question of QUESTIONS) {
      console.log(`\n  Q: ${question}`);
      const { sql } = await askdb.ask(question);
      console.log(`  SQL: ${sql}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\nFast path skipped: ${msg}`);
  }

  // ── Build the language model from askdb.config.ts settings ─────────────────
  //
  // For the advanced paths below, the model is wired explicitly. The fast path
  // above handles this internally via the AI registry.
  const model = await ai.createLanguageModelFromEnv(runtimeConfig.ai.aiEnv);

  if (!model) {
    console.error(
      "\nNo API key configured. Set OPENAI_API_KEY in .env and retry.",
    );
    process.exit(1);
  }

  // ── Path A — direct ask() with full schema context (BYO model) ─────────────
  //
  // Wire schema, model, and dialect explicitly for full control. Use this when
  // you need per-call model selection, dialect overrides, or custom pipeline
  // options unavailable through the facade. For the common case, prefer the
  // fast path above.
  console.log(
    "\n── A. Direct (BYO model — schema, model, dialect wired explicitly) ────────",
  );

  for (const question of QUESTIONS) {
    console.log(`\n  Q: ${question}`);
    const result = await ask({ question, schema, model, dialect: "postgres" });
    console.log(`  SQL: ${result.sql}`);
  }

  // ── Path B — ask() with RAG (semantic retrieval) ───────────────────────────
  //
  // For larger schemas (many tables / columns), build a vector index and pass
  // a retriever so only the relevant schema chunks are sent to the model.
  // createEmbeddingModelFromEnv uses the same config but defaults to the
  // embedding model (text-embedding-3-small) rather than the chat model.
  const embeddingModel = await ai.createEmbeddingModelFromEnv(
    runtimeConfig.ai.aiEnv,
  );

  if (!embeddingModel) {
    console.log("\nSkipping RAG path — no embedding key configured.");
    return;
  }

  // createAiSdkEmbedder bridges the AI SDK EmbeddingModel to the Embedder
  // interface expected by buildSchemaIndex.
  const embedder = createAiSdkEmbedder({ model: embeddingModel });

  // createMemoryStore keeps the index in-process.
  // Swap in createFileStore for a persistent disk cache, or
  // createPgvectorStore to store vectors in PostgreSQL.
  const index = await buildSchemaIndex({
    schema,
    embedder,
    store: createMemoryStore(),
    embedderId: "openai",
  });

  console.log(
    `\n── B. With RAG (${index.stats.chunksTotal} chunks indexed) ──────────────────────────`,
  );

  for (const question of QUESTIONS) {
    console.log(`\n  Q: ${question}`);
    const result = await ask({
      question,
      schema,
      model,
      dialect: "postgres",
      retriever: index.retriever,
      totalSchemaChunkCount: index.stats.chunksTotal,
      // Only activate retrieval when the schema exceeds this chunk count.
      // Below the threshold, the full schema fits in the prompt anyway.
      retrievalThresholdChunks: 20,
    });
    console.log(`  SQL: ${result.sql}`);
  }
}

main().catch((error: unknown) => {
  console.error("\nError:", error);
  process.exit(1);
});
