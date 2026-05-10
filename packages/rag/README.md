# @askdb/rag

Deterministic retrieval over AskDB Schema v2 artifacts. `@askdb/rag` chunks the describable schema, indexes chunks with your embedder and vector store, and returns a retriever you can pass to `@askdb/core` `ask({ retriever })`.

> Status: pre-1.0. Phase 8 ships BYO embeddings and BYO stores with in-memory, file-backed, and pgvector adapters.

## Install

```bash
pnpm add @askdb/rag @askdb/core
# only if you use the pgvector adapter:
pnpm add pg
```

`pg` is an optional peer dependency. The chunker, in-memory store, and file store do not require it.

## Quickstart

```ts
import { ask, loadSchema } from "@askdb/core";
import { buildSchemaIndex, loadChunkerSourcesFromDir } from "@askdb/rag";
import { createMemoryStore } from "@askdb/rag/stores/memory";

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

- `chunkSchema`, `chunkSchemaDir`, `chunkSchemaBundle` — deterministic Schema v2 chunking.
- `buildSchemaIndex` — chunk, embed, upsert, write `schema.lock.json`, and return a retriever.
- `createRetriever` — bind an existing store and embedder without indexing.
- `@askdb/rag/stores/memory` — in-memory cosine store.
- `@askdb/rag/stores/file` — binary embedding file plus JSON metadata.
- `@askdb/rag/stores/pgvector` — pgvector adapter with documented setup SQL.
- `@askdb/rag/embedders/openai` — optional AI SDK `embedMany()` reference helper using `text-embedding-3-small` by default.

## Sensitive Fields

Sensitive describable-layer content and sensitive identifiers are excluded from RAG chunks by default. Identifier and type grounding remains in `@askdb/core` prompt formatting, where sensitive columns are tagged `(sensitive)` unless the caller explicitly omits sensitive identifiers.

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
