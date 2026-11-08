# AskDB — agent instructions

This file is for coding agents implementing AskDB into a project (e.g. wiring up NL-to-SQL in someone's app). If you're building AskDB itself, see the repo's own `AGENTS.md` instead. It's a map: each fact is one line, with the page that says more.

Machine-readable docs indexes:

- `/llms.txt` — page index with descriptions
- `/llms-full.txt` — full docs content in one file

## What AskDB is

AskDB is a library, not a service. `ask({ question, schema, model, dialect })` from `@askdb/core` takes a schema artifact (physical structure plus human-authored enrichment) and a Vercel AI SDK `LanguageModel`, and returns SQL that has passed heuristic checks. It never executes SQL — your app runs it through its own connection, under its own database role, timeouts, and approval flow.

One pipeline, several surfaces: the `askdb` CLI, the `@askdb/client` / `@askdb/core` library, `@askdb/http-api`, and Studio (the local schema-authoring UI) all share the same generation and validation logic. Whichever surface you wrap, the same SQL checks run. The `askdb` CLI and `@askdb/http-api` can't pass a tenant scope yet ([#277](https://github.com/Ygilany/AskDB/issues/277)), so they can't serve a schema with a tenant policy: without a scope, `ask()` throws `TenantScopeError`. Serve multi-tenant schemas through the library.

## The package landscape

AskDB is a workspace of small, layered packages — install only what your use case needs. Full table (purpose, install command, key exports) lives at `/reference/packages/`. At a glance:

- **`@askdb/core`** — the pipeline (`ask()`, `loadSchema()`) and the built-in dialects; `ask({ dialect: "postgres" })` needs no engine package. Everything else builds on this. API: `/reference/core-api/`.
- **`@askdb/client`** — config-driven facade (`createAskDb()`); resolves schema, model, and dialect from `askdb.config.ts`. API: `/reference/client-api/`.
- **`@askdb/config`** — loads and checks `askdb.config.ts` for the client and the first-party surfaces. API: `/reference/config-api/`.
- **`@askdb/ai`** — config-driven AI provider registry used by `@askdb/client` and the first-party surfaces. OpenAI, Anthropic, Google, Azure/Foundry, and Vercel AI Gateway providers are built in; install the matching `@ai-sdk/*` package (an optional peer, e.g. `@ai-sdk/openai`). The former `@askdb/ai-openai` / `-anthropic` / `-google` / `-azure` packages were removed before 1.0. API: `/reference/ai-api/`.
- **`@askdb/introspect`** — reads a database, or a Prisma schema file, and writes the schema artifact; the CLI and Studio are built on it. API: `/reference/introspect-api/`.
- **`@askdb/postgres` / `-mysql` / `-sqlite` / `-sqlserver`** — engine packages: introspection connector, catalog query runner, and a re-export of that engine's dialect (the dialect specs themselves ship inside `@askdb/core`). API: `/reference/introspect-api/#engine-packages`.
- **`@askdb/prisma`** — introspection connector for `.prisma` schema files, with no database connection. An optional peer of `askdb` and `@askdb/studio`, and pnpm must approve the build of its `@prisma/engines` dependency: see `/guides/integrations/prisma/`. API: `/reference/introspect-api/#askdbprisma`.
- **`@askdb/rag`** — schema chunking, indexing, and retrieval for large schemas. API: `/reference/rag-api/`.
- **`@askdb/http-api`** — minimal HTTP wrapper over `ask()` (`POST /ask`, `GET /health`). Reference: `/reference/http-api/`.
- **`@askdb/studio`** — browser UI for schema enrichment and sample NL-to-SQL checks. Reference: `/reference/studio/`.
- **`askdb`** (CLI) — batteries-included binary; good for trying AskDB out or scripting. Reference: `/reference/cli/`.

## Decision points for common scenarios

- **Just trying it out** → the `askdb` CLI alone (`npx askdb@latest init`), no code needed. See `/quickstart/`.
- **Embedding in a Node service** → `@askdb/client` + `@askdb/config` + the AI SDK package for your provider, e.g. `@ai-sdk/openai` (or `@askdb/core` directly if you construct the model yourself). See `/guides/embed-in-node/`.
- **Need an HTTP boundary** (non-Node clients, or one AskDB service shared across consumers) → `@askdb/http-api` behind your own gateway/auth — it has no built-in auth of its own. See `/guides/deploy-as-http-service/`.
- **Schema too big for one prompt** (rule of thumb: more than ~22 tables, or rendered DDL over ~8K tokens) → add `@askdb/rag` with a retriever. See `/guides/rag-for-large-schemas/`.
- **Multi-tenant app** → declare a `tenant-policy.md` in the schema artifact and pass `tenantScope` on every `ask()` call, sourced from your host's auth context. Run `result.sql` with `result.tenantParams` (or `result.unboundSql` with `result.params`), never `result.sql` alone. The database enforces tenant isolation; AskDB's tenant check is a heuristic that catches a forgotten filter, not a boundary. See `/guides/multi-tenancy/`, `/guides/tenant-hierarchy/` for hierarchical (`subtree`) access, and `/guides/enforce-tenancy-in-the-database/` for row-level security and the Postgres grants to revoke.
- **AskDB as an agent tool** → wrap `ask()` as a tool/function definition over the library or HTTP surface — there's no first-party MCP server yet. See `/guides/integrations/agents-mcp/`.
- **Switching database engines** → swap the engine package and the `dialect` value; the schema artifact format and the `ask()` API don't change. See `/guides/switch-engines/`.
- **Connecting to SQL Server** (the connection-string formats, a self-signed certificate, your own `mssql` pool) → see `/guides/connect-to-sql-server/`.

## Where to find what

| To | Read |
| --- | --- |
| Introspect a database without a connection, from an export | `/guides/introspect-without-a-connection/` |
| Let Studio run the SQL it generates | `/guides/enable-studio-execute/` |
| Rerun a stored query with new values, without a model call | `/guides/rerun-a-query-with-new-values/` |
| Cap the rows a query returns | `/guides/cap-the-rows-a-query-returns/` |
| Keep sensitive columns out of prompts | `/guides/keep-sensitive-columns-out-of-prompts/` |
| Match the server's string settings (`backslashEscapes`) | `/guides/match-server-string-settings/` |
| Bundle an app that uses AskDB | `/guides/bundle-your-app/` |
| Fix an error AskDB shows | `/guides/troubleshooting/` |
| Know what each SQL check reads and rejects | `/reference/sql-checks/` |
| Write the schema artifact's files | `/reference/schema-artifact-format/` |
| Write `tenant-policy.md` | `/reference/tenant-policy/` |
| Set an `askdb.config.ts` key | `/reference/config/` |
| Look up an `ask()` option or result field | `/reference/core-api/ask/` |
| Look up an error class or code | `/reference/core-api/errors/` |

## Wiring the AI model

`ask()`'s contract is `model: LanguageModel` — a plain Vercel AI SDK model object. Produce one config-driven with `@askdb/client` / `@askdb/ai` (when AskDB should own provider config), or construct a raw AI SDK model and pass it to `ask()` (when the host app already resolves provider config). Check whether the host codebase already constructs AI SDK models before picking — don't introduce a second, parallel provider-config system for one call site. See `/guides/bring-your-own-model/`.

`ai` is a **peer dependency** of `@askdb/core` (`^6.0.0 || ^7.0.51`, so AI SDK 6, or 7.0.51 and later): add `ai` to the host app's own `package.json` next to `@askdb/core` and reuse the host's existing AI SDK version — never install a second copy. The config-driven path (`@askdb/ai` and `@askdb/client`) requires `ai@7`. Introspection-only installs need `ai` too: every package that depends on `@askdb/core` imports it at load time. Yarn doesn't install peers, so add `ai` explicitly there.

## Safety and trust boundaries

- `ask()`, the CLI and the HTTP API return SQL and never run it. Studio's Playground runs it only when you set `studio.execute.enabled: true`, for local testing. Don't wire generated SQL to a database call without a review/approval step the host app controls.
- Tenant scope comes from the host application's own auth context — never from user input or from anything an agent decides on its own. AskDB validates and binds the scope you supply; it doesn't know who's asking. The prompt names `:tenant_*` placeholders, never the tenant IDs: AskDB binds the IDs after the model answers. `tenantScope.context` (role, label, description, `attributes`, …) and a `global` scope's `reason` do go into the prompt, so keep personal data out of them.
- Sensitive columns (`sensitive: true` in the schema artifact) can be tagged in the prompt (default) or omitted entirely (`--omit-sensitive-from-prompt`), which also leaves out any description, alias, enum value, concept or retrieved text that names them, and any foreign key that touches them. The exception is the tenant policy block: a sensitive column it names stays in the prompt. AskDB never reads your rows, so a value reaches the prompt only as text in the schema artifact (an `enum` list, a description, an example question) or in the question. See `/concepts/privacy-model/`.
- The SQL checks are heuristic defense in depth, not a security boundary: run generated SQL under a read-only, least-privilege role, and make the database the tenant boundary. See `/concepts/safety-boundaries/` for why, `/reference/sql-checks/` for what each check reads and rejects, and `/guides/run-safely-in-prod/` for the setup.

## Going deeper

- `/llms.txt` — page index with descriptions, useful for scoping which doc to fetch next.
- `/llms-full.txt` — the entire docs site as one file, for deep machine-readable context.
- The docs site nav (`/`) for human-readable depth: Guides, Concepts, and Reference sections.
- `/guides/upgrading/` — what to change in the host app for each AskDB release. Read it before you bump the AskDB packages in an existing integration.
