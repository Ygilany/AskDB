# AskDB — agent instructions

This file is for coding agents implementing AskDB into a project (e.g. wiring up NL-to-SQL
in someone's app). If you're building AskDB itself, see the repo's own `AGENTS.md` instead.

Machine-readable docs indexes:

- `/llms.txt` — page index with descriptions
- `/llms-full.txt` — full docs content in one file

## What AskDB is

AskDB is a library, not a service. `ask({ question, schema, model, dialect })` from
`@askdb/core` takes a schema artifact (physical structure plus human-authored enrichment) and
a Vercel AI SDK `LanguageModel`, and returns validated SQL. It never executes SQL — your app
runs it through its own connection, under its own database role, timeouts, and approval flow.

One pipeline, several surfaces: the `askdb` CLI, the `@askdb/client` / `@askdb/core` library,
`@askdb/http-api`, and Studio (the local schema-authoring UI) all share the same generation
and validation logic. Whichever surface you wrap, you get the same guarantees.

## The package landscape

AskDB is a workspace of small, layered packages — install only what your use case needs. Full
table (purpose, install command, key exports) lives at `/reference/packages/`. At a glance:

- **`@askdb/core`** — the dialect-agnostic pipeline (`ask()`, `loadSchema()`). Everything else builds on this.
- **`@askdb/client`** — config-driven facade (`createAskDb()`); resolves schema, model, and dialect from `askdb.config.ts`.
- **`@askdb/ai` + `@askdb/ai-openai` / `-anthropic` / `-google` / `-azure`** — AI provider adapters used by `@askdb/client` and the first-party surfaces.
- **`@askdb/postgres` / `-mysql` / `-sqlite` / `-sqlserver`** — engine adapters: introspection connector, catalog templates, and a re-export of that engine's dialect (the dialect specs themselves ship inside `@askdb/core`).
- **`@askdb/rag`** — schema chunking, indexing, and retrieval for large schemas.
- **`@askdb/http-api`** — minimal HTTP wrapper over `ask()` (`POST /ask`, `GET /health`).
- **`@askdb/studio`** — browser UI for schema enrichment and sample NL-to-SQL checks.
- **`askdb`** (CLI) — batteries-included binary; good for trying AskDB out or scripting.

## Decision points for common scenarios

- **Just trying it out** → the `askdb` CLI alone (`npx askdb@latest init`), no code needed. See `/quickstart/`.
- **Embedding in a Node service** → `@askdb/client` + `@askdb/config` + one AI provider adapter (or `@askdb/core` directly if you construct the model yourself). See `/guides/embed-in-node/`.
- **Need an HTTP boundary** (non-Node clients, or one AskDB service shared across consumers) → `@askdb/http-api` behind your own gateway/auth — it has no built-in auth of its own. See `/guides/deploy-as-http-service/`.
- **Schema too big for one prompt** (rule of thumb: more than ~30 tables, or rendered DDL over ~8K tokens) → add `@askdb/rag` with a retriever. See `/guides/rag-for-large-schemas/`.
- **Multi-tenant app** → declare a `tenant-policy.md` in the schema artifact and pass `tenantScope` on every `ask()` call, sourced from your host's auth context. See `/guides/multi-tenancy/`.
- **AskDB as an agent tool** → wrap `ask()` as a tool/function definition over the library or HTTP surface — there's no first-party MCP server yet. See `/guides/integrations/agents-mcp/`.
- **Switching database engines** → swap the engine adapter package and the `dialect` value; the schema artifact format and the `ask()` API don't change. See `/guides/switch-engines/`.

## Wiring the AI model

`ask()`'s contract is `model: LanguageModel` — a plain Vercel AI SDK model object. You can
produce one via `@askdb/ai-*` adapters + `@askdb/client` (config-driven; the right default
when AskDB should own provider config) or by constructing a raw AI SDK model and passing it to
`ask()` directly (better when the host app already resolves provider config elsewhere, or
needs to reuse one model instance for LLM calls AskDB doesn't make). Check whether the host
codebase already constructs AI SDK models before picking — don't introduce a second, parallel
provider-config system for one call site. Full decision rule and per-provider recipes:
`/guides/bring-your-own-model/`.

## Safety and trust boundaries

- AskDB returns SQL; it never executes it. Don't wire generated SQL to a database call without
  a review/approval step the host app controls.
- Tenant scope comes from the host application's own auth context — never from user input or
  from anything an agent decides on its own. AskDB validates and binds the scope you supply; it
  doesn't know who's asking.
- Sensitive columns (`sensitive: true` in the schema artifact) can be tagged in the prompt
  (default) or omitted entirely (`--omit-sensitive-from-prompt`) — either way, the underlying
  *values* never enter the prompt, only the schema metadata.
- See `/concepts/safety-boundaries/` for the full validator ruleset (read-only, single
  statement, no system schemas, tenant filters) and `/concepts/privacy-model/` for exactly
  what does and doesn't cross the boundary to the model.

## Going deeper

- `/llms.txt` — page index with descriptions, useful for scoping which doc to fetch next.
- `/llms-full.txt` — the entire docs site as one file, for deep machine-readable context.
- The docs site nav (`/`) for human-readable depth: Guides, Concepts, and Reference sections.
