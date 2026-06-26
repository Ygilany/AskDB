# @askdb/client

## 1.0.0-beta.2

### Patch Changes

- Updated dependencies [dc380bc]
  - @askdb/config@1.0.0-beta.9

## 0.1.0-beta.1

### Minor Changes

- 354c833: Add `@askdb/client`: a config-aware `createAskDb()` facade that resolves schema, model, and dialect from the runtime config so callers only pass a question. `schema`, `model`, and `dialect` remain optional per-call overrides. `ask()` in `@askdb/core` is unchanged and remains the pure, BYO-model primitive.
- 354c833: `@askdb/client` now throws typed errors and supports `unknownDialect: "throw" | "fallback-postgres"`. The HTTP API uses those error types to return 400 `schema_parse_error` for missing schema files and to preserve the postgres fallback for unrecognized schema providers.
