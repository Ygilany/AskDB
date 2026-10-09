# @askdb/rag

## 0.2.0-beta.24

### Minor Changes

- 11e2457: Restructure the `ai` config into provider connections plus a section per model, and stop a RAG key from reaching the wrong provider (#345, #435).
  
  **@askdb/config**: `ai.providerConfig.<provider>` now holds provider connections only (keys, endpoints, Azure resources, API versions), as one object or a list of named connections. The model choice moves to two sections, each with an optional `provider` and `connection`: `ai.language` (`model`, `modelFamily`, `reasoning`) and `ai.embedding` (`model`, `dimensions`), which `rag.embedder: "ai"` uses. The embedding model can come from a different provider than the language model, so an Anthropic setup can embed with OpenAI, and one provider can have two connections, such as two Azure resources. `ai.embedding.model` is required with `rag.embedder: "ai"`: AskDB no longer picks an embedding model for you. AskDB assumes no vector width: `ai.embedding.dimensions` is optional for every model and only requests a size from the provider. Unset, AskDB uses the width the model returns, learned when an index is built, so the pgvector store no longer needs a width in the config. A custom provider's connection is keyed by its provider id. The runtime config gains `ai.language`, `ai.embedding` (each with an `env` map built from that section's connection only) and `deprecations`. `ai.aiEnv` and the flat map's language keys are unchanged. Its `ASKDB_RAG_EMBEDDER*` keys follow the new shape: `ASKDB_RAG_EMBEDDER` is `"ai"` for the old `"openai"` and `"ai-sdk"`, `ASKDB_RAG_EMBEDDER_DIMENSIONS` holds only a configured width (or, for the mock embedder with the pgvector store, its 64), and `ASKDB_RAG_EMBEDDER_API_KEY` and `_BASE_URL` are no longer written, since the embedding key lives on its connection.
  
  Existing configs keep loading, apart from the cases listed below. Each old key is translated at load and reported once per process as a Node `DeprecationWarning` (code `ASKDB_CONFIG_DEPRECATED`) naming the old and new location, never the value: `providerConfig.<provider>.model` and Azure's `modelFamily` move to `ai.language`, `ai.reasoning` to `ai.language.reasoning`, `providerConfig.custom` to `providerConfig.<provider id>`, `rag.embedder: "openai" | "ai-sdk"` and `rag.embedderConfig.openai` to `rag.embedder: "ai"` plus `ai.embedding`, and `rag.storeConfig.pgvector.dimensions` (with an AI embedder) to `ai.embedding.dimensions`. With `rag.embedder: "mock"`, `rag.storeConfig.pgvector.dimensions` gets the same warning, saying it's ignored: the mock embedder's vectors are always 64 wide, as Studio already assumed. The old keys and the deprecated type aliases (`OpenaiConfig`, `OpenaiAiConfig`, …, `OpenaiRagEmbedderConfig`, `defaultRagEmbeddingDimensions`) are removed at 1.0.
  
  The key leak is fixed. A `rag.embedderConfig.openai.apiKey` or `.baseUrl` now moves to a connection of the embedding model's provider, and only when that provider is `openai`, `azure`, `foundry` or `gateway`; before, Studio sent the OpenAI key to the language model's provider (for example Google). The `askdb-rag` CLI's embedder settings no longer fall back to `ASKDB_AI_API_KEY` or `ASKDB_AI_BASE_URL`, so a custom provider's key or the gateway's URL no longer reaches OpenAI.
  
  These old-shape configs loaded before and now fail to load, each with an error that says what to change:
  
  - a `rag.embedderConfig.openai.apiKey` or `.baseUrl` whose embedding model would come from a provider other than `openai`, `azure`, `foundry` or `gateway` (the leak above);
  - `rag.embedder: "ai-sdk"` with no embedding model on a provider other than `openai`, `azure` or `foundry`, which asked that provider for `text-embedding-3-small`;
  - `rag.embedder: "ai-sdk"` with Anthropic as the language model's provider, which never embedded, since Anthropic has no embeddings API;
  - `rag.embedderConfig.openai.dimension` and `rag.storeConfig.pgvector.dimensions` set to different widths, where the pgvector value used to win silently;
  - an old key set next to its replacement: `ai.reasoning` with `ai.language.reasoning`, `ai.providerConfig.custom` with `ai.providerConfig.<provider id>`, or `rag.embedderConfig` with `ai.embedding`.
  
  **@askdb/rag**: New `detectEmbeddingDimensions(embedder)` learns an embedder's vector width by embedding one short text, so hosts don't have to hard-code a width. `createPgvectorStore`'s `dimensions` is now optional: it's needed only to create the table (`setupSql()`, or `ensureSchema()` when the table doesn't exist yet). The store gains `tableDimensions()`, and `ensureSchema()` now refuses an existing table whose width differs from `dimensions` with a `PgvectorDimensionMismatchError` (exported, with `table`, `tableDimensions` and `dimensions`), instead of keeping it and letting inserts fail partway through indexing. `buildSchemaIndex` records the width of the vectors it wrote in the lock file's `dimensions`.
  
  **@askdb/ai**: `ProviderEnvSpec.defaultEmbeddingModel` is deprecated. When an env map names no embedding model, `openai`, `azure` and `gateway` still fall back to their default, now with a one-time `DeprecationWarning` (code `ASKDB_AI_DEFAULT_EMBEDDING_MODEL`); the fallback is removed at 1.0. Configs never reach it, since `ai.embedding.env` always names the model. The "no embedding model" error points at `ai.embedding.model`, and the gateway and Anthropic messages name `ai.embedding` instead of the old `rag` keys.
  
  **@askdb/studio**: RAG embeds through the `ai.embedding` section's connection only. Settings shows the active embedder, the workspace reports the configured language model instead of a hard-coded `gpt-4o-mini`, and a RAG failure names the section, provider, connection and model. Studio no longer assumes a vector width. With pgvector, the first index build asks the embedding model for its width (one short embedding call) and creates the table at that width; an existing table of another width is refused with a 409 before any chunk is embedded, and the message names the table and how to resolve it: drop it and build again, point `rag.storeConfig.pgvector.table` at a new table, or set `ai.embedding.dimensions` to the table's width. The status page no longer creates the table, and shows the width recorded at the last build. Index ids carry a width only when `ai.embedding.dimensions` sets one, so an existing index built without one shows as stale once: rebuild it, or, for an old-shape config, set the width the deprecation warning names to keep it. Setup writes the new shape.
  
  **askdb**: `askdb init` writes the model to `ai.language.model` and no longer writes `rag.embedderConfig: {}`.
- e511e16: **`askdb rag` replaces the `askdb-rag` binary, reads `askdb.config.*`, and assumes no embedding width.**
  
  - **`askdb rag index | query | setup-store`** is the RAG CLI now, in the `askdb` package. `@askdb/rag` no longer depends on `@askdb/config`, so a host that embeds the library doesn't install the config loader. Its `askdb-rag` binary stays until 1.0 as a stub that names the `askdb rag` command to run, without echoing its arguments, and exits `1`; it doesn't forward, because `askdb rag` reads its store from config where `askdb-rag` always defaulted to the file store.
  - **Config fallbacks.** Flags still win. The schema dir falls back to `introspection.outputDir`, `--store` to `rag.store`, `--pg-url` and `--pg-table` to `rag.storeConfig.pgvector`, `--file-path` to `rag.storeConfig.file.basePath`, and `--embedder` to `rag.embedder`. The pgvector index strategy comes from `rag.storeConfig.pgvector.indexStrategy`. A store flag for a store the run doesn't use (`--file-path` on pgvector, `--pg-url` or `--pg-table` on the file or memory store) is an error. `askdb rag --help` and `--version` work without a config. Flags take `--flag value` or `--flag=value`. An error repeats an argument only when it looks like a name or number, and a connection string in place of `[schema-dir]` is refused, so a password typed in the wrong place doesn't reach stderr.
  - **`--embedder mock|ai`.** `ai` embeds with the `ai.embedding` model, through the same path as Studio, and needs `rag.embedder: "ai"`. `--embedder-model` overrides `ai.embedding.model`. `--embedder openai` and `--embedder ai-sdk` are deprecated aliases of `ai` until 1.0 and print a warning; `openai` also requires `ai.embedding.provider: "openai"`. To migrate from `--embedder openai`, configure `ai.embedding` and `rag.embedder: "ai"`.
  - **`--api-key` is removed.** Set the key on a connection in `ai.providerConfig`.
  - **AI embedder ids change** from `openai:<model>[:<dims>]` to Studio's `ai-sdk:<provider>:<model>:<dims|default>`, so the CLI and Studio accept each other's indexes. An index built by `askdb-rag --embedder openai` re-embeds once on the next `askdb rag index`, and `query` refuses it until then. Mock indexes (`mock:lexical-<dims>`) stay valid.
  - **No assumed width.** `setup-store` requires `--dimensions` and fails before connecting without it; it used to default to the mock embedder's 64, or 1536 with `--embedder openai`. The CLI's list of OpenAI model widths is gone: `index` and `query` take `--dimensions`, else `ai.embedding.dimensions`, else the model's own width (mock: 64), and `index` learns a new pgvector table's width from the model. A pgvector table of another width fails before any chunk is embedded, with the fix in flags: drop the table, pass `--pg-table` for a new table, or pass `--dimensions <table width>`.
- 9021e54: Raise the supported Node floor from `>=22.12` to `>=22.14` (`engines.node` in every published package). `better-sqlite3` 13, which the `@askdb/sqlite` and `@askdb/studio` peer ranges allow, segfaults on Node 22.12.0 through 22.13.1 and works from 22.14.0 (bisected on linux-x64; upstream WiseLibs/better-sqlite3#1514). Hosts on Node 22.12 or 22.13 should upgrade to Node 22.14 or newer.
- ad0b170: `@askdb/rag` exports `aiSdkEmbedderId({ provider, model, dimensions })`, the `embedderId` an index records when it's embedded through an AI SDK model built from an `ai.embedding` section: `ai-sdk:<provider>:<model>:<dimensions>`, ending in `default` when no width was requested. Studio and `askdb rag` now both build their ids with it, so the promise that either accepts an index the other built no longer rests on two copies of the format. Studio's ids are unchanged.
- b668070: **Store-verified incremental indexing, schema-scoped chunk ids, and stricter sensitive filtering.** Upgrading triggers a one-time full reindex.
  
  - **The store is now the source of truth.** `buildSchemaIndex` skips a chunk only when the vector store reports, for its id, the hash of the same text embedded by the same embedder: `UpsertRecord.hash` now covers the embedder id too, so an interrupted embedder or store switch can't leave another model's vectors passing as current. Before, it trusted `schema.lock.json`, so switching stores (memory → file/pgvector), a restarted in-memory store, or a committed lock pointed at a fresh pgvector database embedded 0 chunks, and `ask()` quietly fell back to full DDL. The pgvector adapter now persists a `content_hash` column and implements `hashesByPrefix`. `ensureSchema()`/`setupSql()` add the column to existing tables with `ALTER TABLE … ADD COLUMN IF NOT EXISTS`. If you provision the table from your own migrations and never call `ensureSchema()`, add `ALTER TABLE askdb_rag_chunks ADD COLUMN IF NOT EXISTS content_hash text;` (with your table name) before upgrading.
  - **Lock file v2.** `schema.lock.json` now records `dimensions` and the store identity (`store: { kind, location? }`; the file store records only its kind, so a committed lock carries no machine-local path). A missing or older-version lock, a different embedder id (unset vs. set counts as different), or different dimensions re-embeds everything. Stores without `hashesByPrefix` fall back to the lock's hashes only when `describe()` reports the same store identity; a custom store with neither re-embeds every chunk on each run. New `force: true` option (CLI: `askdb-rag index --force`) re-embeds unconditionally. The memory store describes itself as `ephemeral`, and the indexer neither reads nor writes the lock for it, so an in-process index (Studio's memory store, `askdb-rag index --store memory`) no longer overwrites the lock of a persisted index. A lock written for another schema id is logged (`askdb.rag.lock_schema_mismatch`) and none of its ids are deleted. New `checkIndexMatches({ lockFilePath, schemaId, embedderId, dimensions })` tells a host whether a persisted index can be queried with its embedder; `askdb-rag query` uses it. A build that switches embedders marks the lock `incomplete` until it finishes, so an interrupted switch is refused at query time, and Studio shows it as stale. `SchemaLockFile.version` is now `2` (exported as `SCHEMA_LOCK_VERSION`), and `readLockFile` returns `undefined` for a version-1 lock or one missing `schemaId` or `hashes`.
  - **Schema-scoped chunk ids.** Ids are now `chunk:<schemaId>:<local-id>` (e.g. `chunk:orders-users:table:public.orders#cql`, was `chunk:table:public.orders#cql`), so schemas sharing a store no longer overwrite each other. `%` and `:` in the schema id are percent-encoded (`shop:eu` → `chunk:shop%3Aeu:…`), so two schemas' ids can never collide. Orphan pruning is limited to the schema being indexed. Before, indexing schema A deleted schema B's chunks. Stores without `idsBySchema` prune only the ids listed in the schema's previous lock (never by id prefix, which can match another schema's old-format ids, e.g. `chunk:table:` for a schema named `table`) and log `askdb.rag.orphan_cleanup_limited`. New optional `VectorStore` methods: `idsBySchema(schemaId)` (all built-in stores) and `describe()`, which returns the newly exported `VectorStoreDescriptor` (`kind`, `location`, `dimensions`, `ephemeral`, and a `widthHint` the indexer appends to its width-mismatch error). The first run after upgrading re-embeds every chunk and deletes that schema's old-format ids.
  - **Sensitive filtering.** Sensitive-column mentions now match case-insensitively, the same as `@askdb/enrich`: a concept saying "filter by SSN" is excluded when `ssn` is sensitive. Concept labels and synonyms are checked too. By default the chunker also drops table descriptions, aliases, and primary entities that mention a sensitive column, from the table chunk and from the common query language and example question headings that repeat them, along with the describable layer of non-sensitive columns whose description, aliases, enum values, or notes mention one. Tenant policy sections that mention a sensitive column are excluded, like concepts. `stats.sensitiveExcluded` now also counts chunks emitted with part of their describable text dropped, and both sensitive counters count every chunk a long, split source produces. Relationship chunks touching a sensitive column (not only a sensitive table) are excluded.
  - **Dimension handling.** The memory store throws on a query-vector dimension mismatch instead of silently comparing only the overlapping dimensions. pgvector `upsert` rejects vectors whose size differs from the store's width (its `dimensions`, or the existing table's once `ensureSchema()` has read it), and `describe()` reports that width. The indexer reports embedder/store dimension mismatches with what to do for each store (a new pgvector table, or deleting the file store's embeddings files).
  - **CLI.** The mock embedder honors `--dimensions`. `setup-store` defaults its dimensions from the embedder the same way `index` does (mock: 64), so the default `setup-store` + `index --store pgvector` pair works. **`setup-store` with no flags used to create `vector(1536)` and now creates `vector(64)`**: to provision for OpenAI embeddings, pass `--embedder openai` (1536 for `text-embedding-3-small`) or `--dimensions <n>`. `-k` must be a positive integer. `index --store pgvector` provisions the table and checks its dimensions. `query` refuses a different embedder or dimensions than the lock records (or a lock with no embedder id), and rejects `--store memory`, which can't see another process's index. `--embedder` must be `mock` or `openai`.
  - **File store.** Writes go to temp files and are then renamed. The `.json` records a SHA-256 of the `.bin`, so an interrupted write is detected on load with a "delete and reindex" message. A store emptied and reopened accepts vectors of any width.
  - **pgvector `pg` resolution.** `connectionString` mode now falls back to resolving `pg` from `process.cwd()` (or the new `resolveFrom` option) and handles the CJS default export, matching `@askdb/postgres`'s driver loading without depending on it.
- f2f6239: **Sensitive-column mentions are matched schema-wide (ADR 0017).** `@askdb/rag` now checks every table's describable text (table, column, common query language, example question, and business context) against the sensitive columns of the whole schema, not only that table's, so an `orders` note that says "match via users.ssn" is excluded by default. A column that is sensitive only because its table is, now counts only when mentioned as `table.column`, so generic names of a sensitive table (`id`, `org_id`) no longer drop unrelated concepts and tenant policy sections. To support this, `loadSchema()` and `loadSchemaFromJson()` set `sensitiveFromTable: true` on columns that are sensitive solely through their table. `@askdb/core`'s mention rule takes a qualified name as `{ table, column }` (bare names stay literal, dots included) and gains `createMentionMatcher(names)`, which compiles a name list once for checking many texts; the [schema-v2 contract](https://github.com/Ygilany/AskDB/blob/main/docs/contracts/schema-v2.md#sensitive-propagation) states the full rule. Some schemas will exclude different chunks after upgrading, which re-embeds those chunks on the next index run.

### Patch Changes

- e7ea657: Accept `ai` from 7.0.51 again, and `@ai-sdk/openai` from 4.0.29 for `@askdb/rag`'s embedding peer. The last dependency bump raised every `ai` range to `^7.0.113` and `@askdb/rag`'s `@ai-sdk/openai` peer to `^4.0.74`, though AskDB needs nothing newer. A host that pins an older `ai` couldn't install the release with npm (`ERESOLVE`), and pnpm gave AskDB a second AI SDK instead of the host's. These ranges now rise only when AskDB needs a newer version or a security fix, and the changelog says which (#403).
- c6e289a: The OpenAI, Azure OpenAI / Foundry, Google, and Anthropic providers are now built into `@askdb/ai`. The `@askdb/ai-*` packages are deprecated (ADR 0006 amendment, Option E).
  
  **@askdb/ai**: ships the four providers (moved unchanged from `@askdb/ai-*`) plus a new zero-dependency `gateway` provider for the Vercel AI Gateway (`AI_GATEWAY_API_KEY`, model ids like `openai/gpt-4o-mini`). Each provider loads its AI SDK package lazily, the first time it builds a model. `@ai-sdk/openai`, `@ai-sdk/azure`, `@ai-sdk/google`, and `@ai-sdk/anthropic` are now **optional peer dependencies**: install the one for the provider you configure. If it's missing, model creation fails with `Provider 'google' requires the optional peer dependency @ai-sdk/google. Install it: npm i @ai-sdk/google`. The peer ranges are `^4.0.0` (the contract tests pass against 4.0.0), so a host on an older 4.x SDK isn't forced to upgrade. The lazy imports are written so esbuild builds without the SDKs a host didn't install. webpack 5 doesn't: see the webpack note under the deprecated packages below.
  
  - `createAiRegistry()` with no arguments registers every built-in provider. It also accepts built-in names and aliases (`createAiRegistry(["openai"])`), mixed freely with `AiProviderAdapter` objects. Custom adapters work unchanged.
  - New exports: `BUILTIN_AI_PROVIDERS` (one table of names, aliases, env vars, default models, and SDK packages), `getBuiltinAiProviderSetup`, `listBuiltinAiProviderSetups`, the adapters `openaiProvider` / `azureProvider` / `googleProvider` / `anthropicProvider` / `gatewayProvider`, and the `AiProviderSelector` type.
  - `aiProviderMissingMessage` now says to pass the built-in name to `createAiRegistry()` and to install `@ai-sdk/<provider>`, instead of naming an `@askdb/ai-*` package. `aiKeyMissingMessage` also lists the gateway.
  - The `gateway` provider maps reasoning effort through its upstream (`openai/`, `google/`, `anthropic/` model ids), sends embedding `dimensions` for `openai/` and `google/` models and refuses them for other upstreams, and rejects model ids without an `<upstream>/` prefix.
  - The `openai` provider now also sends `forceReasoning: true` with a reasoning effort, so an `@ai-sdk/openai` release that predates a model family (gpt-6 before 4.0.60) still sends it.
  - The built-in adapters' `createLanguageModel` / `createEmbeddingModel` are now `async`. The `AiProviderAdapter` contract already allowed promises, and `AiRegistry` methods were already async.
  
  **@askdb/ai-openai, @askdb/ai-azure, @askdb/ai-google, @askdb/ai-anthropic (deprecated)**: each now only re-exports its adapter from `@askdb/ai`, which it depends on directly (it was a peer). It keeps its `@ai-sdk/*` dependency, so existing installs and imports keep working, except in a webpack bundle. These packages will be removed before 1.0 (#347).
  
  **webpack users, including shim users who change nothing:** importing `@askdb/client`, `@askdb/ai`, or a shim now reaches every built-in provider's `import("@ai-sdk/<x>")`, and webpack 5 fails with `Module not found: Error: Can't resolve '@ai-sdk/google'` (and the other SDKs you don't have). Before this release, `@askdb/client` + `@askdb/ai-openai` bundled without the other SDKs. Install all four `@ai-sdk/*` packages, or mark the ones you don't use as `externals` (with ESM output, use `externalsType: "module"` and the bare package names):
  
  ```js
  // webpack.config.js: list the @ai-sdk/* packages you don't install.
  module.exports = {
    // ...
    externals: {
      "@ai-sdk/anthropic": "commonjs @ai-sdk/anthropic",
      "@ai-sdk/azure": "commonjs @ai-sdk/azure",
      "@ai-sdk/google": "commonjs @ai-sdk/google",
    },
  };
  ```
  
  A provider whose SDK isn't installed then fails at runtime with the install message. esbuild needs no change.
  
  To migrate:
  
  ```diff
  - npm i @askdb/ai-openai
  + npm i @askdb/ai @ai-sdk/openai
  
  - import { openaiProvider } from "@askdb/ai-openai";
  - const askdb = createAskDb({ config, providers: [openaiProvider] });
  + const askdb = createAskDb({ config }); // or providers: ["openai"]
  
  - const ai = createAiRegistry([openaiProvider]);
  + const ai = createAiRegistry(["openai"]);
  ```
  
  **@askdb/client**: `createAskDb({ config })` no longer throws when neither `providers` nor `registry` is passed. It registers every built-in `@askdb/ai` provider, and `ai.provider` in the config picks one. `providers` also accepts built-in names. The four `@ai-sdk/*` packages are declared as optional peers (`^4.0.0`) so strict installs such as Yarn Plug'n'Play pass the host's SDK through to `@askdb/ai`.
  
  **@askdb/config**: new `ai.provider: "gateway"` branch (`providerConfig.gateway.{apiKey, baseUrl, model}`, flattened to `AI_GATEWAY_API_KEY` / `ASKDB_AI_BASE_URL` / `ASKDB_AI_MODEL`). `ASKDB_AI_PROVIDERS` includes `"gateway"`. `DEFAULT_ANTHROPIC_CHAT_MODEL`, `DEFAULT_GOOGLE_CHAT_MODEL`, and `DEFAULT_GATEWAY_CHAT_MODEL` are now exported. A test in `@askdb/client` (which depends on both) fails if this list, these defaults, or the env var names `flatten` writes drift from the built-in provider table. `askdb init` and Studio's setup wizard take each provider's default API key and model env var names from `@askdb/ai`'s provider table instead of keeping their own copies.
  
  **askdb, @askdb/http-api, @askdb/studio**: register providers with `createAiRegistry()` and depend on `@askdb/ai` plus all four `@ai-sdk/*` packages instead of `@askdb/ai-*`. They still work from env/config alone. `askdb init` and Studio setup now take their provider choices and scaffolded env var names from `@askdb/ai`'s table, and both offer the Vercel AI Gateway. Google now scaffolds `GOOGLE_AI_MODEL`, the variable the provider actually reads, instead of `GOOGLE_GENERATIVE_AI_MODEL`. Studio's "Get the code" snippet uses `@askdb/client` + `@ai-sdk/<provider>`. `askdb help init` lists every `--ai-provider` value, including `gateway`.
  
  **@askdb/rag**: the deprecation note on `createOpenAiEmbedder` now points at `createAiRegistry(["openai"])` instead of the `@askdb/ai-openai` adapter.
- 9d2e2b4: **@askdb/core**: `ai` is now a **peer dependency** (`^6.0.0 || ^7.0.51`) instead of a bundled dependency, so the host application owns its AI SDK version.
  
  `ask()` takes a `LanguageModel` your app constructs, so core has to use the same `ai` instance your app does. Bundling `ai` pinned core's own copy: when `1.0.0-beta.41` moved that pin to `ai@^7`, hosts on AI SDK 6 (e.g. `ai@^6` + `@ai-sdk/openai@^3`) had to either migrate their whole AI stack or end up with two copies of `ai` whose `LanguageModel` types disagree. Both AI SDK 6 and AI SDK 7 hosts are now supported.
  
  **Migration (install-time breaking):** if you relied on `ai` arriving transitively through `@askdb/core` (or through `@askdb/postgres`, `@askdb/introspect`, `@askdb/rag`, …), add it to your own `package.json`:
  
  ```bash
  pnpm add ai            # or: npm install ai
  ```
  
  npm 7+ and pnpm (with the default `auto-install-peers`) install a missing required peer automatically, but declaring it pins the version you actually use. Yarn (classic and Berry) doesn't install peers, so Yarn users must add `ai` themselves. That includes introspection-only installs (`@askdb/introspect`, `@askdb/prisma`, the engine packages), because core loads `ai` when it is imported. No source changes are needed.
  
  Core now passes the NL→SQL and enrichment system prompts to `generateText` as `system`, which AI SDK 6 reads and AI SDK 7 still honors as a deprecated alias of `instructions`. This also fixes AI SDK 6 hosts silently losing the system prompt: AI SDK 6 ignores `instructions`.
  
  **@askdb/rag**: the optional `ai` and `@ai-sdk/openai` peers now accept AI SDK 6 as well (`ai` `^6.0.0 || ^7.0.51`, `@ai-sdk/openai` `^3.0.0 || ^4.0.29`), so AI SDK 6 hosts can install `@askdb/rag` without a peer conflict. `createAiSdkEmbedder` works with either major.
  
  **@askdb/studio**: the Playground's "Get the code" install lines now list the required peers. The `@askdb/client` snippet installs `@askdb/core` and `ai` (before, it had no `ai` at all with the AI Gateway provider), and the direct `@askdb/core` snippet installs `ai`, listed once even for the AI Gateway provider, whose SDK is `ai` itself.
  
  **@askdb/client**: the README's install line now lists `@askdb/core` and `ai`, the client's required peers, for package managers that don't install peers (Yarn).
  
  The config-driven path (`@askdb/ai` and `@askdb/client`) still requires AI SDK 7.
- 01f289a: `loadChunkerSourcesFromBundleJson()` reads bundles with `@askdb/core`'s `BundledSchemaV2` type instead of its own copy of the shape, so it follows the format core's loader defines. No runtime change.
- a62205d: Internal: `createMockEmbedder` in the `askdb-rag` CLI module is no longer exported. It was never reachable through the package's `exports` map; the CLI's `--embedder mock` behavior is unchanged.
- 7a0f777: **One rule for "mentions a sensitive column by name".** `@askdb/core` exports `findMentionedNames(text, names)`: a whole-word, case-insensitive match whose ends may not touch a letter, digit, or `_` of any script. `@askdb/rag`'s chunker and `@askdb/enrich`'s `findSensitiveColumnReferences` (Studio's authoring warning) both use it, so they agree on names like `ssn$` or `café`; before, enrich's `\b` boundaries missed `ssn$` and matched `caf` inside `café`. Studio keeps the details of a memory-store index in memory instead of `schema.lock.json`, which the indexer no longer writes for an ephemeral store.
- Updated dependencies [e7ea657]
- Updated dependencies [c610168]
- Updated dependencies [9d2e2b4]
- Updated dependencies [224a05b]
- Updated dependencies [d6e52ed]
- Updated dependencies [ce8d837]
- Updated dependencies [9021e54]
- Updated dependencies [cca5656]
- Updated dependencies [f2f6239]
- Updated dependencies [7a0f777]
- Updated dependencies [5d3a38b]
  - @askdb/core@1.0.0-beta.44

## 0.2.0-beta.23

### Patch Changes

- ab2150b: Bump dependencies: AI SDK (`ai` 7.0.113, `@ai-sdk/*` 4.0.x), zod 4.6, mysql2 3.24, pg 8.23, @prisma/internals 7.10, @inquirer/prompts 8.7, React 19.3 and Vite 8.3 for Studio, and vitest 5 across the workspace.
- 2787b21: Release packaging fixes:

  - Ship `LICENSE` and `NOTICE` in `@askdb/ai`, `@askdb/ai-anthropic`, `@askdb/ai-azure`, `@askdb/ai-google`, `@askdb/ai-openai`, `@askdb/mysql`, `@askdb/sqlite`, and `@askdb/sqlserver` (they were listed in `files` but missing from the tarballs).
  - `@askdb/studio`: React, Radix UI, lucide-react, react-router, clsx, tailwind-merge, and class-variance-authority are bundled into the prebuilt browser client, so they are now dev dependencies and are no longer installed with the package.
  - Add `"sideEffects": false` to library packages (`@askdb/rag` lists its bin entry as side-effectful), and point `homepage` at the relevant askdb.tools page.
  - Package READMEs no longer link to repo-relative paths that npmjs.com cannot resolve.

- Updated dependencies [1338535]
- Updated dependencies [70a9513]
- Updated dependencies [ad9c9e5]
- Updated dependencies [1338535]
- Updated dependencies [764ec32]
- Updated dependencies [ab2150b]
- Updated dependencies [5e89384]
- Updated dependencies [5dbe2d6]
- Updated dependencies [2787b21]
- Updated dependencies [933bd6c]
- Updated dependencies [cb7dec5]
- Updated dependencies [8410840]
- Updated dependencies [41f1ed6]
  - @askdb/core@1.0.0-beta.43
  - @askdb/config@1.0.0-beta.12

## 0.2.0-beta.22

### Minor Changes

- 1131e77: CommonJS applications can now `require()` AskDB packages, where package resolution previously failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The minimum supported Node.js version is now 22.12, which provides unflagged `require(esm)` support. No runtime behavior or exported symbols changed.

### Patch Changes

- Updated dependencies [595182d]
- Updated dependencies [1af6263]
- Updated dependencies [1131e77]
  - @askdb/core@1.0.0-beta.42
  - @askdb/config@1.0.0-beta.11

## 0.2.0-beta.21

### Minor Changes

- 0c62b25: Upgrade the Vercel AI SDK integration to AI SDK 7.

  This moves `ai` to `^7.0.51` and the first-party provider packages to their AI SDK 7-compatible majors:

  - `@ai-sdk/openai` `^4.0.29`
  - `@ai-sdk/anthropic` `^4.0.29`
  - `@ai-sdk/google` `^4.0.33`
  - `@ai-sdk/azure` `^4.0.30`

  AI SDK 7 requires Node.js 22 or newer, so AskDB packages that expose or carry the AI SDK runtime now advertise `node >=22`. Core model calls now use the AI SDK 7 `instructions` option, and the Google adapter uses the renamed `createGoogle` provider factory.

### Patch Changes

- Updated dependencies [0c44b76]
- Updated dependencies [0c62b25]
  - @askdb/core@1.0.0-beta.41
  - @askdb/config@1.0.0-beta.10

## 0.2.0-beta.20

### Patch Changes

- Updated dependencies [350c03a]
  - @askdb/core@1.0.0-beta.40

## 0.2.0-beta.19

### Patch Changes

- Updated dependencies [7311ac5]
  - @askdb/core@1.0.0-beta.36

## 0.2.0-beta.18

### Patch Changes

- Updated dependencies [dc380bc]
  - @askdb/config@1.0.0-beta.9

## 0.2.0-beta.17

### Patch Changes

- 96e6963: Add `withEmbeddingProviderOptions` helper to `@askdb/ai` and use it in the OpenAI and Azure adapters, eliminating the near-identical per-adapter middleware blocks. Deprecates `createOpenAiEmbedder` in `@askdb/rag` — use `createAiSdkEmbedder` with an `@askdb/ai-openai` model or the `@askdb/ai` registry instead; the helper will be removed in 1.0.
- Updated dependencies [d4a0a1d]
- Updated dependencies [c0603e1]
- Updated dependencies [0f0c481]
  - @askdb/config@1.0.0-beta.8

## 0.2.0-beta.16

### Patch Changes

- baf5ad8: Restore AI SDK 6 embedding compatibility and preserve RAG embedding options.
- baf5ad8: Refresh dependency ranges across the workspace.
- Updated dependencies [baf5ad8]
  - @askdb/core@1.0.0-beta.26

## 0.2.0-beta.15

### Patch Changes

- Updated dependencies [05a589a]
  - @askdb/config@1.0.0-beta.7

## 0.2.0-beta.14

### Patch Changes

- dda0abf: Persist ignored table metadata and keep ignored table references out of RAG concept and relationship chunks.
- Updated dependencies [dda0abf]
  - @askdb/core@1.0.0-beta.21

## 0.2.0-beta.13

### Patch Changes

- Updated dependencies [bc8642f]
  - @askdb/core@1.0.0-beta.20

## 0.2.0-beta.12

### Patch Changes

- Updated dependencies [1eacf3f]
  - @askdb/config@1.0.0-beta.6

## 0.2.0-beta.11

### Minor Changes

- 70a655c: Add untracked tables feature: tables marked as untracked are excluded from LLM prompts and RAG indexing while remaining visible in the schema and studio. Tracking status persists in the describable layer (tables/\*.md) and survives re-introspection. Studio UI adds a toggle in the Sensitivity tab and a visual indicator with filter in the table list.

### Patch Changes

- Updated dependencies [70a655c]
  - @askdb/core@0.5.0-beta.18

## 0.2.0-beta.10

### Patch Changes

- Updated dependencies [36c35b4]
  - @askdb/core@0.5.0-beta.16

## 0.2.0-beta.9

### Minor Changes

- c3c0f21: Add Phase 10 multi-tenant isolation proof.

  `@askdb/core` gains a complete tenant isolation pipeline:
  - **Tenant policy format**: `tenant-policy.md` with YAML front-matter (roots, hierarchy, scoped tables, polymorphic mappings, global tables, enforcement mode) and markdown body for business context.
  - **Runtime `TenantScope`**: Unified scope input on `ask()` with four access kinds (`ids`, `subtree`, `multi_root`, `global`), optional `tenantFilters`, and advisory `context`. Fail-closed when policy exists but scope is missing.
  - **Prompt assembly**: Tenant policy block always injected into NL→SQL prompts (security boundary) with hierarchy, scoped table paths, named placeholders, and enforcement rules.
  - **SQL guardrails**: Heuristic validation checks scoped tables for tenant predicates, polymorphic tables for type discriminators, and unknown tables. Configurable `strict` (throw) vs `warn` (return warnings) enforcement.
  - **SQL output modes**: `tenantSqlMode` option — `"sql-only"` (default) inlines literal values with `=` → `IN` rewriting; `"sql-params"` converts to positional `$N` parameters. Result includes `tenantBindings` and `tenantParams`.
  - **Schema evolution**: New tables classified as `unknown`; orphaned table/column/FK references flagged as warnings.

  `@askdb/rag` adds `"tenant-policy"` as a chunk type. The chunker emits one chunk per H2 section from `tenant-policy.md` body. Source loaders (directory and bundle) now load tenant policy. `synthesizeRetrievedDdl` includes retrieved tenant policy context in focused prompts.

### Patch Changes

- Updated dependencies [c3c0f21]
  - @askdb/core@0.5.0-beta.14

## 0.2.0-beta.8

### Patch Changes

- Updated dependencies [5ceadc8]
- Updated dependencies [5ceadc8]
  - @askdb/config@0.3.0-beta.5

## 0.2.0-beta.7

### Patch Changes

- Updated dependencies [02edcc5]
  - @askdb/config@0.3.0-beta.4
  - @askdb/core@0.5.0-beta.12

## 0.2.0-beta.6

### Patch Changes

- Updated dependencies [1f46cd1]
  - @askdb/config@0.3.0-beta.3
  - @askdb/core@0.5.0-beta.10

## 0.2.0-beta.5

### Patch Changes

- 0084012: Add `ensureSchema()` to the pgvector adapter and auto-invoke it in Studio on every RAG operation, eliminating the "relation does not exist" error when pgvector is configured. Add `askdb-rag setup-store` CLI command for explicit schema provisioning in CI and production pipelines.

## 0.2.0-beta.4

### Minor Changes

- 0f9a8a9: Re-export all stores and embedders from the `@askdb/rag` root entry point. Consumers can now import `createMemoryStore`, `createFileStore`, `createPgvectorStore`, `createAiSdkEmbedder`, and `createOpenAiEmbedder` directly from `@askdb/rag` without using sub-path imports. Sub-path imports (`@askdb/rag/stores/memory`, `@askdb/rag/embedders/ai-sdk`, etc.) remain available and point to the same modules.

## 0.2.0-beta.3

### Patch Changes

- 52cfa58: Honor the configured `rag.store` branch in Studio RAG flows and expose pgvector store metadata in Studio status.

## 0.2.0-beta.2

### Patch Changes

- Updated dependencies [07dbc9a]
- Updated dependencies [eb325a2]
- Updated dependencies [a4f14f7]
- Updated dependencies [57db375]
  - @askdb/config@0.3.0-beta.2
  - @askdb/core@0.5.0-beta.4

## 0.2.0-beta.1

### Patch Changes

- Updated dependencies [06e5f54]
  - @askdb/config@0.3.0-beta.1

## 0.2.0-beta.0

### Minor Changes

- b018d88: Add the Phase 8 RAG layer.

  `@askdb/rag` ships deterministic Schema v2 chunking, BYO embedder and vector store interfaces, in-memory/file/pgvector stores, lock-file based index reuse, and the `askdb-rag` CLI.

  `@askdb/core` now accepts an optional `retriever` in `ask()`. When retrieval is used, core synthesizes a focused DDL block from retrieved schema chunks; without a retriever the existing full-DDL prompt path is preserved.

### Patch Changes

- b0d84d7: Route RAG embeddings through provider-agnostic AI SDK helpers and have Studio default to the configured AskDB AI connection when an embedding-capable key is configured.
- b24af19: **Breaking (`@askdb/config`):** `bootstrapAskDbEnv` installs a runtime snapshot (`getAskDbRuntimeConfig`) instead of merging AskDB settings into `process.env`. Legacy flat `askdb.config` exports are removed; use `defineConfig` only. `getAskDbRuntimeEnv` is removed—pass `getAskDbRuntimeConfig().ai.aiEnv` into `@askdb/core` env helpers.

  **`@askdb/core`:** Document and align with explicit `AskDbAiEnv` from `@askdb/config`.

  First-party apps and RAG/TUI entrypoints read configuration through the runtime façade.

- daa2625: Surface AI SDK token usage in Studio for RAG indexing, RAG queries, and sample SQL generation.
- 6df0045: Point package bins at checked-in wrapper files so workspace installs create command shims before build output exists.
- Updated dependencies [5e20605]
- Updated dependencies [b0d84d7]
- Updated dependencies [dc9a6ce]
- Updated dependencies [25980e4]
- Updated dependencies [289e63e]
- Updated dependencies [a90543b]
- Updated dependencies [fdfd059]
- Updated dependencies [b018d88]
- Updated dependencies [4e462eb]
- Updated dependencies [b24af19]
- Updated dependencies [cd23f50]
  - @askdb/core@0.5.0-beta.0
  - @askdb/config@0.3.0-beta.0
