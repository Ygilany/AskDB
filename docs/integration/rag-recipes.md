# RAG Recipes

Phase 8 adds `@askdb/rag` for retrieval over Schema v2 directories. Use it when a schema is large enough that full DDL plus descriptions, common query language, example questions, and concepts crowd the NL-to-SQL prompt.

## In-Memory Store

```ts
import { ask, loadSchema } from "@askdb/core";
import { buildSchemaIndex, loadChunkerSourcesFromDir } from "@askdb/rag";
import { createMemoryStore } from "@askdb/rag/stores/memory";

const schemaDir = "./my-app.schema";
const schema = loadSchema(schemaDir);
const sources = loadChunkerSourcesFromDir(schemaDir);

const embedder = async (texts: string[]) => {
  // Replace with your provider's batched embedding call.
  return texts.map((text) => [text.length, text.split(" ").length]);
};

const index = await buildSchemaIndex({
  schema: sources,
  embedder,
  store: createMemoryStore(),
  embedderId: "example:embedding-model",
});

await ask({
  question: "Top customers by paid revenue last month",
  schema,
  model: yourLanguageModel,
  retriever: index.retriever,
  totalSchemaChunkCount: index.stats.chunksTotal,
});
```

## File-Backed Store

```ts
import { join } from "node:path";
import { createFileStore } from "@askdb/rag/stores/file";

const store = createFileStore({ basePath: join(schemaDir, "schema") });

await buildSchemaIndex({
  schema: sources,
  embedder,
  store,
  embedderId: "openai:text-embedding-3-small",
  lockFilePath: join(schemaDir, "schema.lock.json"),
});
```

This writes `schema.embeddings.bin`, `schema.embeddings.json`, and `schema.lock.json`. Re-running embeds only chunks the store doesn't already hold with the same content hash. The lock records the embedder id, store identity (kind + location), and vector dimensions; changing any of them — or deleting the lock — re-embeds everything. Pass `force: true` (CLI: `--force`) to re-embed unconditionally.

The file store writes each file to a temp path and renames it into place, and the `.json` records a checksum of the `.bin`. If the two ever disagree (for example after a crash mid-write), loading the store fails with a message asking you to delete both files and reindex.

### Upgrading from an earlier `@askdb/rag`

Chunk ids are now scoped to the schema (`chunk:<schemaId>:table:public.orders` instead of `chunk:table:public.orders`) and `schema.lock.json` moved to version 2. The first index run after upgrading re-embeds every chunk once and deletes that schema's old-format ids. The built-in stores find them by `schemaId` (`idsBySchema`), so they're removed even without the old lock. Custom stores without `idsBySchema` rely on the ids listed in the previous lock.

## pgvector Store

```ts
import { createPgvectorStore } from "@askdb/rag/stores/pgvector";

const store = createPgvectorStore({
  connectionString: process.env.DATABASE_URL!,
  dimensions: 1536,
  table: "askdb_rag_chunks",
});
```

The adapter exposes two ways to provision the required extension, table, and indexes:

**`ensureSchema()` — idempotent, runs the DDL directly**

```ts
await store.ensureSchema(); // safe to call on every startup
```

Uses `CREATE EXTENSION IF NOT EXISTS` and `CREATE TABLE IF NOT EXISTS` guards throughout, so repeated calls are a no-op against an already-provisioned database. It also adds the `content_hash` column to tables created by older versions (`ALTER TABLE … ADD COLUMN IF NOT EXISTS`), and throws a clear error if the existing table's `embedding` column has different dimensions than the store was configured with. Studio and `askdb-rag index --store pgvector` call it automatically.

The adapter stores each chunk's content hash, so the indexer can check what the table actually holds. A committed `schema.lock.json` pointed at a fresh database still indexes everything.

**`setupSql()` — returns the DDL for your own migration system**

```ts
console.log(store.setupSql()); // pipe into psql or your migration runner
```

Use this when you want explicit DDL in a versioned migration file rather than runtime provisioning.

**CLI — `askdb-rag setup-store`**

```bash
askdb-rag setup-store --pg-url "$DATABASE_URL" --embedder openai   # 1536 dimensions
askdb-rag setup-store --pg-url "$DATABASE_URL" --dimensions 768
```

Runs `ensureSchema()` from the command line. Useful in CI pipelines, Dockerfiles, and staging environment bootstrap scripts. Without `--dimensions`, the dimensions follow the embedder, the same way `index` resolves them (default mock embedder: 64; `--embedder openai`: 1536 for `text-embedding-3-small`).

Several schemas can share one table: ids are scoped per schema, and reindexing one schema only prunes that schema's chunks.

## Embedder Providers

`@askdb/rag` accepts one function:

```ts
type Embedder = (texts: string[]) => Promise<number[][]>;
```

Provider examples:

- OpenAI via `@askdb/ai` registry (recommended):

```ts
import { createAiRegistry } from "@askdb/ai";
import { openaiProvider } from "@askdb/ai-openai";
import { createAiSdkEmbedder } from "@askdb/rag/embedders/ai-sdk";

const registry = createAiRegistry([openaiProvider]);
const model = await registry.createEmbeddingModelFromEnv(process.env);
const embedder = createAiSdkEmbedder({ model });
```

- OpenAI via `createOpenAiEmbedder` (deprecated, removed in 1.0):

```ts
// Use the registry approach above instead.
import { createOpenAiEmbedder } from "@askdb/rag/embedders/openai";

const embedder = createOpenAiEmbedder({ model: "text-embedding-3-small" });
```

- Any AI SDK embedding model:

```ts
import { openai } from "@ai-sdk/openai";
import { createAiSdkEmbedder } from "@askdb/rag/embedders/ai-sdk";

const embedder = createAiSdkEmbedder({
  model: openai.embedding("text-embedding-3-small"),
});
```

- AI Gateway: provide the same `Embedder` function using your gateway's embeddings endpoint.
- Cohere or Voyage: map each returned provider vector to `number[]`.
- Local models: call Ollama, Transformers.js, or your own embedding service behind the same function.

Keep `embedderId` stable and descriptive, such as `openai:text-embedding-3-small`, so `schema.lock.json` invalidates correctly when the model changes. Going from no `embedderId` to one (or back) also counts as a change. `askdb-rag query` refuses to run with a different embedder or dimensions than the lock records.

## Retrieval Threshold

`ask({ retriever })` accepts `totalSchemaChunkCount`. Pass `index.stats.chunksTotal` so small schemas can keep using full DDL while larger schemas switch to focused retrieved DDL.

Sensitive describable-layer chunks are excluded by default. That covers text that mentions a sensitive column by name (whole word, case-insensitive), such as a concept that says "filter by SSN" or a table description that names the `email` column. Set `includeSensitiveDescribable: true` only when your deployment policy allows sensitive schema descriptions or aliases to be embedded.
