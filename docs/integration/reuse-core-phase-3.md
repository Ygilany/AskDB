# Reusing `@askdb/core` (Phase 3+ surfaces)

This note lists **stable entrypoints** and **semantic contracts** that MCP servers, minimal HTTP adapters, or other hosts should reuse instead of duplicating policy. Aligns with [`docs/specs/modes-and-observability.md`](../specs/modes-and-observability.md) and [`docs/specs/http-api.md`](../specs/http-api.md).

## Preferred integration shape

Call **`ask()`** from [`packages/core/src/ask.ts`](../../packages/core/src/ask.ts) with:

- `question`, `schema` (`NormalizedSchema` from [`loadNormalizedSchemaFromJson`](../../packages/core/src/schema/parse.ts)), `model` (AI SDK `LanguageModel`)
- Optional **`logger`** implementing [`AskDbLogger`](../../packages/core/src/logging/askdb-logger.ts) — plug in **`createAskDbLogger()`** for JSON lines + correlation ID
- Optional **`mode`** — [`AskDbModeV1`](../../packages/core/src/modes/types.ts), contract in [`docs/contracts/modes-v1.md`](../contracts/modes-v1.md)
- Optional **`explain`**, **`omitSensitiveIdentifiersFromNlToSqlPrompt`**, **`deps`** (`generatePostgresSelectSql` overrides for tests)

Returning **`AskPipelineResult`** (`sql`, optional `result`, optional `explain`).

Avoid reimplementing: NL→SQL prompt assembly (`buildNlToSqlUserPrompt`), SQL guardrails (`validatePostgresSelectSql`), or mode-specific post-execute logging hooks unless you deliberately fork policy.

## Exports hosts typically need

Imported from **`@askdb/core`** (`packages/core/src/index.ts`):

- Pipeline: **`ask`**, **`AskPipelineOptions`**, **`AskPipelineResult`**
- Modes: **`parseAskDbModeV1`**, **`DEFAULT_ASKDB_MODE`**, **`AskDbModeV1`**
- Logs: **`createAskDbLogger`**, **`AskDbLogger`**, **`AskDbLogEvent`**, log level helpers
- Schema: **`loadNormalizedSchemaFromJson`**, **`NormalizedSchema`**, sensitive DDL helpers (`formatSchemaForNlToSql`, …)

## Stable log `event` strings

Prefer comparing against **`AskDbLogEvent`** keys (see [`packages/core/src/logging/log-events.ts`](../../packages/core/src/logging/log-events.ts)); values are prefixed with `askdb.` and treated as stable for integrators parsing JSON lines.

## Non-goals here

Routing, authentication, MCP tool schemas, and HTTP transport belong in Phase 3 application code; **policy** (modes, sensitive-field DDL defaults, validation) stays in **`@askdb/core`**.

## References

- [`docs/contracts/modes-v1.md`](../contracts/modes-v1.md)  
- [`docs/contracts/sensitive-fields-and-modes.md`](../contracts/sensitive-fields-and-modes.md)  
- Root [`README.md`](../../README.md) — CLI flags and env mirror what hosts should expose where applicable  
