# @askdb/rag

Deterministic retrieval over AskDB Schema v2 artifacts. `@askdb/rag` chunks the describable schema, indexes chunks with your embedder and vector store, and returns a retriever you can pass to `@askdb/core` `ask({ retriever })`.

> Status: pre-1.0. Phase 8 ships BYO embeddings and BYO stores with in-memory, file-backed, and pgvector adapters.

## Install

```bash
pnpm add @askdb/rag @askdb/core
# only if you use the pgvector adapter:
pnpm add pg
# only if you use the OpenAI embedder helper or CLI `--embedder openai`:
pnpm add ai @ai-sdk/openai
```

`pg`, `ai`, and `@ai-sdk/openai` are optional peer dependencies. The chunker, in-memory store, and file store do not require them.

## Quickstart

```ts
import { ask, loadSchema } from "@askdb/core";
import {
  buildSchemaIndex,
  loadChunkerSourcesFromDir,
  createMemoryStore,
  createAiSdkEmbedder,
} from "@askdb/rag";

const schemaDir = "./fixtures/schemas/orders-users.schema";
const schema = loadSchema(schemaDir);
const sources = loadChunkerSourcesFromDir(schemaDir);

const embedder = async (texts: string[]) =>
  texts.map((text) => [text.length, text.charCodeAt(0) ?? 0]);

const index = await buildSchemaIndex({
  schema: sources,
  embedder,
  store: createMemoryStore(),
  embedderId: "demo:tiny",
});

const { sql } = await ask({
  question: "How much revenue did we make last month?",
  schema,
  model: /* your LanguageModel */,
  retriever: index.retriever,
  totalSchemaChunkCount: index.stats.chunksTotal,
});
```

## CLI

```bash
askdb-rag index fixtures/schemas/orders-users.schema --store file
askdb-rag query fixtures/schemas/orders-users.schema \
  --question "How much revenue did we make last month?"
```

The default CLI embedder is a deterministic mock for smoke tests. Use `--embedder openai` with `OPENAI_API_KEY` for real embeddings.

## Public Surface

All exports are available from the root `@askdb/rag` import. Sub-path imports are also supported and point to the same modules — use whichever style you prefer.

### Core

- `chunkSchema`, `chunkSchemaDir`, `chunkSchemaBundle` — deterministic Schema v2 chunking.
- `buildSchemaIndex` — chunk, embed, upsert, write `schema.lock.json`, and return a retriever.
- `createRetriever` — bind an existing store and embedder without indexing.

### Stores

| Root import | Sub-path import | Description |
|---|---|---|
| `createMemoryStore` | `@askdb/rag/stores/memory` | In-memory cosine store. Zero deps. |
| `createFileStore` | `@askdb/rag/stores/file` | Binary embedding file + JSON metadata. |
| `createPgvectorStore` | `@askdb/rag/stores/pgvector` | pgvector adapter with documented setup SQL. Requires `pg`. |

### Embedders

| Root import | Sub-path import | Description |
|---|---|---|
| `createAiSdkEmbedder` | `@askdb/rag/embedders/ai-sdk` | Generic AI SDK `EmbeddingModel` adapter. Requires `ai`. |
| `createOpenAiEmbedder` | `@askdb/rag/embedders/openai` | **Deprecated.** OpenAI convenience helper. Use `createAiSdkEmbedder` with an `@askdb/ai-openai` model or the `@askdb/ai` registry instead. Removed in 1.0. |

### Import examples

```ts
// Everything from the root — simplest DX
import {
  buildSchemaIndex,
  createMemoryStore,
  createAiSdkEmbedder,
  createPgvectorStore,
} from "@askdb/rag";

// Sub-path imports — same modules, explicit namespacing
import { createMemoryStore } from "@askdb/rag/stores/memory";
import { createFileStore } from "@askdb/rag/stores/file";
import { createPgvectorStore } from "@askdb/rag/stores/pgvector";
import { createAiSdkEmbedder } from "@askdb/rag/embedders/ai-sdk";
// Recommended: bring your own model via @askdb/ai-openai + createAiSdkEmbedder
// import { createOpenAiEmbedder } from "@askdb/rag/embedders/openai"; // deprecated, removed in 1.0
```

## Sensitive Fields

Sensitive describable-layer content and sensitive identifiers are excluded from RAG chunks by default. Identifier and type grounding remains in `@askdb/core` prompt formatting, where sensitive columns are tagged `(sensitive)` unless the caller explicitly omits sensitive identifiers.

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
