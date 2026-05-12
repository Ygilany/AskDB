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

This writes `schema.embeddings.bin`, `schema.embeddings.json`, and `schema.lock.json`. Re-running with the same lock file skips unchanged chunks.

## pgvector Store

```ts
import { createPgvectorStore } from "@askdb/rag/stores/pgvector";

const store = createPgvectorStore({
  connectionString: process.env.DATABASE_URL!,
  dimensions: 1536,
  table: "askdb_rag_chunks",
});

console.log(store.setupSql()); // run in your migration system
```

The adapter does not create extensions, tables, or indexes automatically. Run the setup SQL through your own migrations so production DDL remains explicit.

## Embedder Providers

`@askdb/rag` accepts one function:

```ts
type Embedder = (texts: string[]) => Promise<number[][]>;
```

Provider examples:

- OpenAI with AI SDK:

```ts
import { createOpenAiEmbedder } from "@askdb/rag/embedders/openai";

const embedder = createOpenAiEmbedder({
  model: "text-embedding-3-small",
  baseURL: process.env.OPENAI_BASE_URL,
});
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

Keep `embedderId` stable and descriptive, such as `openai:text-embedding-3-small`, so `schema.lock.json` invalidates correctly when the model changes.

## Retrieval Threshold

`ask({ retriever })` accepts `totalSchemaChunkCount`. Pass `index.stats.chunksTotal` so small schemas can keep using full DDL while larger schemas switch to focused retrieved DDL.

Sensitive describable-layer chunks are excluded by default. Set `includeSensitiveDescribable: true` only when your deployment policy allows sensitive schema descriptions or aliases to be embedded.
