# AskDB — agent instructions

This file is for coding agents implementing AskDB into a project (e.g. wiring up NL-to-SQL in someone's app). If you're building AskDB itself, see the repo's own `AGENTS.md` instead.

Machine-readable docs indexes:

- `/llms.txt` — page index with descriptions
- `/llms-full.txt` — full docs content in one file

## What AskDB is

AskDB is a library, not a service. `ask({ question, schema, model, dialect })` from `@askdb/core` takes a schema artifact (physical structure plus human-authored enrichment) and a Vercel AI SDK `LanguageModel`, and returns SQL that has passed heuristic checks. It never executes SQL — your app runs it through its own connection, under its own database role, timeouts, and approval flow.

One pipeline, several surfaces: the `askdb` CLI, the `@askdb/client` / `@askdb/core` library, `@askdb/http-api`, and Studio (the local schema-authoring UI) all share the same generation and validation logic. Whichever surface you wrap, the same SQL checks run. The `askdb` CLI and `@askdb/http-api` can't pass a tenant scope yet ([#277](https://github.com/Ygilany/AskDB/issues/277)), so they can't serve a schema with a tenant policy: without a scope, `ask()` throws `TenantScopeError`. Serve multi-tenant schemas through the library.

## The package landscape

AskDB is a workspace of small, layered packages — install only what your use case needs. Full table (purpose, install command, key exports) lives at `/reference/packages/`. At a glance:

- **`@askdb/core`** — the pipeline (`ask()`, `loadSchema()`) and the built-in dialects; `ask({ dialect: "postgres" })` needs no engine package. Everything else builds on this.
- **`@askdb/client`** — config-driven facade (`createAskDb()`); resolves schema, model, and dialect from `askdb.config.ts`.
- **`@askdb/ai`** — config-driven AI provider registry used by `@askdb/client` and the first-party surfaces. OpenAI, Anthropic, Google, Azure/Foundry, and Vercel AI Gateway providers are built in; install the matching `@ai-sdk/*` package (an optional peer, e.g. `@ai-sdk/openai`). The former `@askdb/ai-openai` / `-anthropic` / `-google` / `-azure` packages were removed before 1.0: use `@askdb/ai` and the `@ai-sdk/*` package instead.
- **`@askdb/postgres` / `-mysql` / `-sqlite` / `-sqlserver`** — engine adapters: introspection connector, catalog query runner, and a re-export of that engine's dialect (the dialect specs themselves ship inside `@askdb/core`). `@askdb/postgres` also exports its catalog SQL templates for the from-export flow.
- **`@askdb/prisma`** — introspection connector for `.prisma` schema files, with no database connection. An optional peer of `askdb` and `@askdb/studio`: install it next to them for Prisma introspection. It brings in Prisma, whose `@prisma/engines` build pnpm 11 must approve (`pnpm add --allow-build=@prisma/engines @askdb/prisma` on pnpm 10.4 or later). See `/guides/integrations/prisma/`.
- **`@askdb/rag`** — schema chunking, indexing, and retrieval for large schemas.
- **`@askdb/http-api`** — minimal HTTP wrapper over `ask()` (`POST /ask`, `GET /health`).
- **`@askdb/studio`** — browser UI for schema enrichment and sample NL-to-SQL checks.
- **`askdb`** (CLI) — batteries-included binary; good for trying AskDB out or scripting.

## Decision points for common scenarios

- **Just trying it out** → the `askdb` CLI alone (`npx askdb@latest init`), no code needed. See `/quickstart/`.
- **Embedding in a Node service** → `@askdb/client` + `@askdb/config` + the AI SDK package for your provider, e.g. `@ai-sdk/openai` (or `@askdb/core` directly if you construct the model yourself). See `/guides/embed-in-node/`.
- **Need an HTTP boundary** (non-Node clients, or one AskDB service shared across consumers) → `@askdb/http-api` behind your own gateway/auth — it has no built-in auth of its own. See `/guides/deploy-as-http-service/`.
- **Schema too big for one prompt** (rule of thumb: more than ~30 tables, or rendered DDL over ~8K tokens) → add `@askdb/rag` with a retriever. See `/guides/rag-for-large-schemas/`.
- **Multi-tenant app** → declare a `tenant-policy.md` in the schema artifact and pass `tenantScope` on every `ask()` call, sourced from your host's auth context. Hierarchical access (`access.kind: "subtree"`) also needs a `resolveTenantDescendants` callback that returns the subtree's IDs grouped by tenant root, keyed by root table ID (`{ "table:public.agencies": ["1"], "table:public.clients": ["5"] }`), never one flat list: root tables have separate ID spaces, so `ask()` binds each root's IDs to its own placeholder and rejects a flat array. Without a resolver `ask()` throws. Tenant IDs come back as driver parameters by default (`tenantSqlMode: "sql-params"`): run `result.sql` with `result.tenantParams`, or `result.unboundSql` with `result.params`, never `result.sql` alone. A custom `AskDialect`, or a `DialectSpec` whose `id` isn't built in, must set `tenantSqlMode` itself when it has a tenant scope. After re-introspecting, keep the policy in step with `schema.json`: under `enforcement: strict`, a column ID the schema no longer has, or a hierarchy cycle, makes `loadSchema()` throw. The database enforces tenant isolation: Postgres row-level security keyed on a per-request setting that the query role can't change, or per-tenant views or roles. By default every Postgres role can change that setting from one statement, through `set_config()` or a `DO` block. AskDB's checks reject both, but they are a lint, so revoke both from `PUBLIC` and never grant them back to the role that runs generated SQL. AskDB's tenant check is a lint that catches a forgotten filter, not a boundary. See `/guides/enforce-tenancy-in-the-database/` for the database setup and `/guides/multi-tenancy/` for the tenant policy.
- **AskDB as an agent tool** → wrap `ask()` as a tool/function definition over the library or HTTP surface — there's no first-party MCP server yet. See `/guides/integrations/agents-mcp/`.
- **Switching database engines** → swap the engine adapter package and the `dialect` value; the schema artifact format and the `ask()` API don't change. See `/guides/switch-engines/`.

## Wiring the AI model

`ask()`'s contract is `model: LanguageModel` — a plain Vercel AI SDK model object. You can produce one via `@askdb/client` / `@askdb/ai` (config-driven; the right default when AskDB should own provider config) or by constructing a raw AI SDK model and passing it to `ask()` directly (better when the host app already resolves provider config elsewhere, or needs to reuse one model instance for LLM calls AskDB doesn't make). Check whether the host codebase already constructs AI SDK models before picking — don't introduce a second, parallel provider-config system for one call site. Full decision rule and per-provider recipes: `/guides/bring-your-own-model/`.

`ai` is a **peer dependency** of `@askdb/core` (`^6.0.0 || ^7.0.51`, so AI SDK 6, or 7.0.51 and later): add `ai` to the host app's own `package.json` next to `@askdb/core` and reuse the host's existing AI SDK version — never install a second copy. The config-driven path (`@askdb/ai` and `@askdb/client`) currently requires `ai@7`. Introspection-only installs need `ai` too: every package that depends on `@askdb/core` (`@askdb/client`, `@askdb/introspect`, `@askdb/prisma`, the engine adapters, `@askdb/enrich`, `@askdb/rag`) imports it at load time. Yarn doesn't install peers, so add `ai` explicitly there.

## Safety and trust boundaries

- `ask()`, the CLI and the HTTP API return SQL and never run it. Studio's Playground runs it only when you set `studio.execute.enabled: true`, for local testing. Don't wire generated SQL to a database call without a review/approval step the host app controls.
- Tenant scope comes from the host application's own auth context — never from user input or from anything an agent decides on its own. AskDB validates and binds the scope you supply; it doesn't know who's asking. The prompt names `:tenant_*` placeholders, never the tenant IDs: AskDB binds the IDs after the model answers. `tenantScope.context` (role, label, description, `attributes`, …) and a `global` scope's `reason` do go into the prompt, so keep personal data out of them. The database, not AskDB's tenant check, enforces tenant isolation (row-level security or per-tenant roles; see `/guides/enforce-tenancy-in-the-database/`).
- Sensitive columns (`sensitive: true` in the schema artifact) can be tagged in the prompt (default) or omitted entirely (`--omit-sensitive-from-prompt`), which also leaves out any description, alias, enum value or retrieved text that names them. The exception is the tenant policy block: a sensitive column it names stays in the prompt. AskDB never reads your rows, so a value reaches the prompt only as text in the schema artifact (an `enum` list, a description, an example question) or in the question.
- See `/concepts/safety-boundaries/` for what the SQL checks cover and don't. They are a lint (heuristic defense in depth), not a security boundary: run generated SQL under a read-only, least-privilege role (`/concepts/safety-boundaries/#run-generated-sql-safely`), and make the database the tenant boundary (`/guides/enforce-tenancy-in-the-database/`). See `/concepts/privacy-model/` for exactly what does and doesn't cross the boundary to the model, including what an embedding provider receives with `@askdb/rag`.

## Going deeper

- `/llms.txt` — page index with descriptions, useful for scoping which doc to fetch next.
- `/llms-full.txt` — the entire docs site as one file, for deep machine-readable context.
- The docs site nav (`/`) for human-readable depth: Guides, Concepts, and Reference sections.
- `/guides/upgrading/` — what to change in the host app for each AskDB release. Read it before you bump the AskDB packages in an existing integration.
