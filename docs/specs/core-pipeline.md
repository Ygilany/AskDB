# Feature: Core Pipeline

**Status:** Complete  
**Packages:** `@askdb/core`, `askdb` (CLI)

## Overview

The core pipeline turns a natural language question and a describable schema into validated SQL. The entry point is `ask()`, which accepts a question, a loaded schema, an `AskDbLanguageModel` (BYO), a dialect identifier or adapter, and optional runtime options (mode, tenant scope, retriever). It returns validated SQL and structured metadata — it does not execute queries.

`AskDbLanguageModel` is `@askdb/core`'s public alias for the AI SDK `LanguageModel` type (from `"ai"`). Provider construction helpers — resolving config from env, instantiating OpenAI/Azure/Google models — live in `@askdb/ai` and the per-provider adapter packages (`@askdb/ai-openai`, `@askdb/ai-azure`, `@askdb/ai-google`), not in core.

The `askdb` CLI wraps `ask()` as the first-party surface, handling config bootstrapping, schema loading, and structured logging. SQL execution and tabular display happen at the CLI layer via the dialect's executor, not inside `ask()`.

## Scope

### In scope

- `ask(options) → AskPipelineResult` — NL→SQL orchestration: prompt assembly, model call, SQL extraction, validation, guardrails
- SQL validation and dialect-aware guardrails (syntax checks, safety allow/deny lists appropriate for read-only use)
- Schema-grounded prompt assembly — DDL block construction from the loaded schema, including describable fields (descriptions, aliases, common query language) when present
- BYO model via `AskDbLanguageModel` — `@askdb/core`'s public alias for the AI SDK `LanguageModel`; no hardcoded provider in core
- Built-in dialect specs for all supported engines — `"postgres"`, `"mysql"`, `"mariadb"`, `"sqlite"`, `"sqlserver"`, `"cockroachdb"` — all in `@askdb/core`; consumers pass a plain string
- `askdb` CLI — `ask` subcommand, `init` template generator, `introspect` shim, structured logging surface
- Schema precheck — early rejection when the question references unknown tables or columns

### Out of scope

- SQL execution — `ask()` returns SQL only; execution is a CLI/host concern via the dialect's executor
- Tabular result display — CLI-layer concern, not part of `ask()` or `@askdb/core`
- Schema introspection — see [`introspection.md`](./introspection.md)
- Schema enrichment authoring — see [`schema-authoring-and-enrichment.md`](./schema-authoring-and-enrichment.md)
- RAG retrieval — see [`rag.md`](./rag.md)
- Multi-tenancy enforcement — see [`multi-tenancy.md`](./multi-tenancy.md)
- Additional database engine introspection connectors — see Phase 11 in roadmap; dialect specs for NL→SQL are already built in

## Design decisions

- **BYO model** — `ask()` accepts `AskDbLanguageModel` (`@askdb/core`'s alias for the AI SDK `LanguageModel`); no provider is bundled into core. Consumers supply their own model instance. Provider construction helpers (`resolveAiConfig`, `createAiRegistry`) live in `@askdb/ai`; concrete adapters in `@askdb/ai-openai`, `@askdb/ai-azure`, `@askdb/ai-google`. See [ADR 0006](../adrs/0006-ai-provider-integration-strategy.md).
- **Dialect as a string, spec, or adapter** — `dialect` accepts a built-in string ID (`"postgres"`, `"mysql"`, etc.), a `DialectSpec` descriptor object, or a full custom `AskDialect` adapter. The string path is the normal case; `@askdb/postgres` is for introspection connectors, not needed for `ask()`. See [ADR 0002](../adrs/0002-integration-package-layout.md).
- **SQL-only output** — `ask()` returns validated SQL; execution is opt-in at the CLI/host layer. `@askdb/core` does not manage database connections.
- **Schema precheck** — the pipeline runs a question-vs-schema precheck before calling the model. If the question references unknown tables or columns, it fails with a structured error before spending a model call.
- **Structured logging throughout** — all pipeline stages emit structured events with a stable `correlationId`. See [`modes-and-observability.md`](./modes-and-observability.md) and [ADR 0001](../adrs/0001-structured-logging-pino.md).

## Contracts and API surface

```ts
ask(options: AskPipelineOptions): Promise<AskPipelineResult>

interface AskPipelineOptions {
  question: string
  schema: AnyNormalizedSchema        // loaded via @askdb/core schema loader
  model: AskDbLanguageModel          // @askdb/core alias for AI SDK LanguageModel
  dialect: AskDialectInput           // "postgres" | "mysql" | DialectSpec | AskDialect
  mode?: AskDbModeV1                 // 'schema_only' | 'bounded_results'
  retriever?: Retriever              // optional RAG retriever from @askdb/rag
  tenantScope?: TenantScope          // optional tenant scope from multi-tenancy
  tenantSqlMode?: TenantSqlOutputMode // 'sql-only' | 'sql-params'
  explain?: boolean
  omitSensitiveIdentifiersFromNlToSqlPrompt?: boolean
  correlationId?: string
  logger?: AskDbLogger
}

interface AskPipelineResult {
  sql: string
  explain?: unknown
  tenantGuardrail?: TenantGuardrailResult
  tenantParams?: unknown[]           // populated when tenantSqlMode = 'sql-params'
  tenantBindings?: TenantBinding[]
}

// Dialect input — all three forms accepted by ask()
type AskDialectInput =
  | BuiltInDialectId        // "postgres" | "mysql" | "mariadb" | "sqlite" | "sqlserver" | "cockroachdb"
  | DialectSpec             // descriptor object with promptBrief, extraForbiddenKeywords, etc.
  | AskDialect              // escape hatch: full custom { generate() } implementation
```

Key events emitted (stable field names, present on every log record):
- `askdb.pipeline.started`
- `askdb.pipeline.generation_started` / `askdb.pipeline.generation_completed`
- `askdb.pipeline.validation_result`
- `askdb.pipeline.completed` / `askdb.pipeline.failed`

## Test bar

- `pnpm build` and `pnpm test` pass from repo root.
- `ask()` with a mocked `LanguageModel` returns validated SQL without a live provider.
- Schema precheck fails with a structured error for questions referencing unknown tables/columns.
- SQL validation correctly rejects unsafe patterns (non-SELECT, dangerous keywords) per dialect rules.
- Prompt assembly with a describable schema fixture includes table descriptions, aliases, and common query language sections.
- A schema directory with only `schema.json` (no `tables/*.md`) produces DDL equivalent to the bare baseline.
- Sensitive column identifiers appear in the DDL tagged `(sensitive)` by default.
- All pipeline events share a stable `correlationId`; log field names do not drift between runs.
- CLI smoke: `askdb ask --schema <fixture> --question "..."` with `ASKDB_MOCK_SQL` set produces valid structured logs and exits 0.
