# ADR 0005 — AskDB config package and env bootstrap

## Status

Accepted.

## Context

First-party apps (`@askdb/cli`, `@askdb/http-api`, `@askdb/studio`) load secrets and defaults from `.env` via `dotenv`, then read canonical names such as `OPENAI_API_KEY`, `ASKDB_*`, and `DATABASE_URL` directly from `process.env`. `@askdb/core` resolves AI configuration from `process.env` in one place (`resolveAskDbAiConfig`), which is good for BYO keys but means:

- Users who prefer **friendly, project-specific** names in `.env` still need those values to end up on the canonical keys the rest of the stack reads.
- A single flat map in `askdb.config.ts` is hard to scan and does not express **grouping** (AI vs database vs introspection vs RAG).

[Prisma’s config file pattern](https://www.prisma.io/docs/orm/reference/prisma-config-reference) (`prisma.config.*` / `.config/prisma.*`, `env()` helper) is a familiar way to map arbitrary `.env` keys onto the names a toolchain expects, without changing runtime libraries to accept a second config object.

## Decision

1. Add **`@askdb/config`**, which exports:
   - `env(name)` — read `process.env[name]` with Prisma-like fail-fast semantics when missing/blank.
   - `defineConfig(config)` — accepts a nested **`AskDbConfig`** and returns an opaque **`AskDbEnvProjection`** whose resolved string map is merged at bootstrap (implementation: `flattenAskDbConfig` → canonical env keys).
   - `flattenAskDbConfig(config)` — validates discriminated branches and constrained unions; applies **`DATABASE_URL`** from `database` and overrides it only when `introspection.providerConfig.postgres.databaseUrl` is set for Postgres introspection; produces the canonical env record.
   - `discoverAskDbConfigPath(cwd)` — locate `askdb.config.<ext>` then `.config/askdb.<ext>` with extension precedence `ts` → `mts` → `cts` → `js` → `mjs` → `cjs`.
   - `bootstrapAskDbEnv(options?)` — load `.env` (optional candidate paths), then merge the discovered config into `process.env` (non-empty values only).

2. Use **`.config/askdb.*`** (not `.config/prisma.*`) so AskDB config can coexist with Prisma’s own config directory layout in the same repository.

3. First-party binaries call `bootstrapAskDbEnv` **after** deciding whether `askdb init` is running: `init` must not require a valid config file (it only writes templates).

4. `askdb init` writes **`askdb.config.ts` only** (no generated `.env`). The template uses **`defineConfig({ ... })`** with the nested shape (`ai`, `database`, `introspection`, `rag`, plus optional `logging` / `modes` / `host` in the type system). Guidance that previously lived in a split **`.env` template** is carried as **comments** inside `askdb.config.ts` (example keys, Pagila/pgvector hints, optional sections). The template imports **`env`** from `@askdb/config` and `import "dotenv/config"` so users can map variables from a **self-managed** `.env` or from the shell. Optional values use **literals** in the config file (for example an empty `apiKey` until you switch to `env("MY_OPENAI_API_KEY")`). **`process.env` is intentionally omitted** from the generated file so editors are less likely to suggest `@types/node` for that file alone.

5. **Legacy flat** `export default { OPENAI_API_KEY: "..." }` (string values only) remains supported briefly: merge treats it like today’s string map. New projects should use nested `defineConfig`.

6. **`@askdb/core`** remains the single resolver for AI keys from **`process.env`**; `@askdb/config` only **hydrates** `process.env` before those resolvers run.

7. **Introspection CLI defaults:** after bootstrap, `askdb introspect` may take **`ASKDB_INTROSPECT_OUT`** as the effective **`--out`** when the user omits `--out`, `--print`, and `--diff`. For **`--engine prisma`**, **`ASKDB_PRISMA_SCHEMA`** may supply **`--prisma-schema`** when the flag is omitted. These env keys are produced from `introspection.outputDir` and `introspection.providerConfig.prisma.schemaPath` when using the nested config file.

## Consequences

- New workspace package and dependency edges from `apps/cli`, `apps/http-api`, and `apps/studio`.
- Documentation and examples describe the `askdb init` single-file template, optional self-managed `.env`, nested authoring, and optional config discovery.
- Library-only consumers can continue to set `process.env` themselves or call `bootstrapAskDbEnv` / merge helpers when they want the same behavior as the CLI.

## Related

- Prisma config reference: [Configuration files](https://www.prisma.io/docs/orm/reference/prisma-config-reference).
- Phase 1 spec supplement: [`docs/specs/phase-1-schema-sql-cli/requirements.md`](../specs/phase-1-schema-sql-cli/requirements.md).
