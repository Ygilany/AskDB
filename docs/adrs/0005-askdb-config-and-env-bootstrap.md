# ADR 0005 — AskDB config package and env bootstrap

## Status

Accepted.

> **Amendment (2026-09):** `@askdb/config` also renders the `ai` block of a new `askdb.config.ts`: `renderAskDbAiConfigScaffold`, on the `@askdb/config/scaffold` entry point, which both `askdb init` and Studio's setup wizard call. Before this, each app kept its own copy of the template with a "keep the two in sync" comment, and neither wrote Azure's required `resourceName`, so a config-only Azure or Foundry setup failed at startup. Options considered: keep both copies and add a test that fails when they differ (the duplication stays, and the test has to live in one app and import the other); move the template into `@askdb/ai` (it owns provider knowledge, but not the config file's shape, and it has no dependency on `@askdb/config`); or move it into `@askdb/config`. `@askdb/config` won because it owns `AskDbConfig`, including the rule that `AzureConfig` / `FoundryConfig` need `resourceName` or `baseUrl`, and both apps already depend on it. The renderer is on a `./scaffold` subpath, not the main entry that user configs import, so scaffolding helpers can change without touching the config API; plan 066 (#353) puts its shared setup helpers there too. Callers pass the API key and model env var names, and the default names stay with the apps. The rest of each app's template (introspection, RAG, Studio sections) is unchanged.

> **Amendment (2026-10):** With the four adapters folded into `@askdb/ai` (ADR 0006, 2026-09 amendment), `askdb init` and Studio take each provider's default API key and model env var names from `@askdb/ai`'s built-in provider table (`getBuiltinAiProviderSetup`), which owns the providers' native env vars, and drop their `AI_DEFAULTS` copies. The renderer stays in `@askdb/config/scaffold` and still takes the names from its callers, so `@askdb/config` gains no dependency on `@askdb/ai`.

> **Amendment (2026-10, #346):** `@askdb/rag` no longer depends on `@askdb/config`. Only its bundled `askdb-rag` CLI read config, and that CLI moved into the `askdb` app as `askdb rag`, which reads config and passes plain values to the library. No library package calls `getAskDbRuntimeConfig()` now: a library that needs AskDB settings takes them from its host, as `@askdb/client` takes a runtime snapshot. Rule 6 and the consequence below still hold for any library that does read config: it goes through `getAskDbRuntimeConfig()`, never `process.env`.

## Context

First-party apps (`askdb`, `@askdb/http-api`, `@askdb/studio`) load secrets and defaults from `.env` via `dotenv`, then read canonical names such as `OPENAI_API_KEY`, `ASKDB_*`, and `DATABASE_URL` directly from `process.env`. Library packages like `@askdb/core`, `@askdb/rag`, and `@askdb/tui` were also reading `process.env` directly, which means:

- Users who prefer **friendly, project-specific** names in `.env` still need those values to end up on the canonical keys the rest of the stack reads.
- A single flat map in `askdb.config.ts` is hard to scan and does not express **grouping** (AI vs database vs introspection vs RAG).
- Library packages silently depend on `bootstrapAskDbEnv` having been called first, making the config flow implicit.

[Prisma’s config file pattern](https://www.prisma.io/docs/orm/reference/prisma-config-reference) (`prisma.config.*` / `.config/prisma.*`, `env()` helper) is a familiar way to map arbitrary `.env` keys onto the names a toolchain expects, without changing runtime libraries to accept a second config object.

## Decision

1. Add **`@askdb/config`**, which exports:
   - `env(name)` / `requiredEnv(name)` — read `process.env` **only while `askdb.config.*` is evaluated** (Prisma-like semantics).
   - `defineConfig(config)` — accepts a nested **`AskDbConfig`** and returns an **`AskDbEnvProjection`**: `{ config, entries }` where `entries` is the output of `flattenAskDbConfig` (canonical string map).
   - `flattenAskDbConfig(config)` — validates discriminated branches and constrained unions; applies **`DATABASE_URL`** from `database` and overrides it only when `introspection.providerConfig.postgres.databaseUrl` is set for Postgres introspection; produces the canonical env record. Does **not** fall back to `process.env` for URLs when the structured value is unset (defaults live in `defaults.ts` / config file `env()`).
   - `discoverAskDbConfigPath(cwd)` — locate `askdb.config.<ext>` then `.config/askdb.<ext>` with extension precedence `ts` → `mts` → `cts` → `js` → `mjs` → `cjs`.
   - `bootstrapAskDbEnv(options?)` — load `.env` (optional candidate paths), load `askdb.config.*`, then install an **in-memory runtime snapshot** (`structured` + `flat` + derived `aiEnv`). It does **not** merge the full AskDB flat map into `process.env`. A **small allowlist** of shell variables (e.g. `ASKDB_MOCK_SQL`, `ASKDB_CORRELATION_ID`, `ASKDB_PRISMA_SCHEMA`, `ASKDB_INTROSPECT_OUT`, `DATABASE_URL`, `PORT`, `HOST`) may override flat entries at bootstrap time for tests, subprocess env, Prisma/Postgres CLI defaults, and platform-assigned listen addresses.

2. Use **`.config/askdb.*`** (not `.config/prisma.*`) so AskDB config can coexist with Prisma’s own config directory layout in the same repository.

3. First-party binaries call `bootstrapAskDbEnv` **after** deciding whether `askdb init` is running: `init` must not require a valid config file (it only writes templates).

4. `askdb init` writes **`askdb.config.ts` only** (no generated `.env`). The template uses **`defineConfig({ ... })`** with the nested shape (`ai`, `database`, `introspection`, `rag`, plus optional `logging` / `modes` / `studio` / `tui` / `httpApi` / `dev`, …). Guidance that previously lived in a split **`.env` template** is carried as **comments** inside `askdb.config.ts` (example keys, Pagila/pgvector hints, optional sections). The template imports **`env`** from `@askdb/config` and `import "dotenv/config"` so users can map variables from a **self-managed** `.env` or from the shell. Optional values use **literals** in the config file (for example an empty `apiKey` until you switch to `env("MY_OPENAI_API_KEY")`). **`process.env` is intentionally omitted** from the generated file so editors are less likely to suggest `@types/node` for that file alone.

5. **Legacy flat** `export default { OPENAI_API_KEY: "..." }` is **removed**: the loader requires `defineConfig({ ... })`.

6. **`@askdb/config`** is the **single package that reads `process.env`** directly. Env-aware AI functions in `@askdb/ai` (e.g. `resolveAiConfig` and registry methods such as `createLanguageModelFromEnv`) accept the env map as an **explicit, required parameter** (typically **`getAskDbRuntimeConfig().ai.aiEnv`**). Library packages obtain all runtime configuration through **`getAskDbRuntimeConfig()`** and must not call `env()`, `requiredEnv()`, or read `process.env` — `env()` is reserved for end-user `askdb.config.*` authoring only.

7. **Introspection CLI defaults:** after bootstrap, `askdb introspect` may take **`ASKDB_INTROSPECT_OUT`** as the effective **`--out`** when the user omits `--out`, `--print`, and `--diff`. For **`--engine prisma`**, **`ASKDB_PRISMA_SCHEMA`** may supply **`--prisma-schema`** when the flag is omitted. These keys are produced from `introspection.outputDir` and `introspection.providerConfig.prisma.schemaPath` when using the nested config file.

## Consequences

- New workspace package and dependency edges from `apps/cli`, `apps/http-api`, `apps/studio`, `packages/rag`, and `packages/tui`.
- Documentation and examples describe the `askdb init` single-file template, optional self-managed `.env`, nested authoring, and optional config discovery.
- **`@askdb/config` is the sole `process.env` reader.** Library packages (`@askdb/rag`, `@askdb/tui`, …) depend on `@askdb/config` and use the typed `getAskDbRuntimeConfig()` gateway. They never reference `process.env` or `env()` outside config files.
- Library-only consumers who embed AskDB packages call `bootstrapAskDbEnv()` first, then read configuration through `getAskDbRuntimeConfig()`.
- Spawning tools may use **`mergeAskDbFlatIntoEnvMap`** with **`getAskDbRuntimeConfig().flat`** (plus any extra keys) to build a child `env` object.

## Related

- Prisma config reference: [Configuration files](https://www.prisma.io/docs/orm/reference/prisma-config-reference).
- Core pipeline spec: [`docs/specs/core-pipeline.md`](../specs/core-pipeline.md).
