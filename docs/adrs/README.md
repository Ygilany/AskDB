# Architecture decision records

Read this index before changing code or reviewing a PR. Each row is a decision AskDB already made between viable options; the ADR holds the options and why the others lost. Don't regress a decision silently: to change one, amend or supersede its ADR in the same PR.

When to write an ADR, and how to keep this index current, is in `AGENTS.md` ("Architecture and decisions").

| ADR | Status | Decision | Don't regress |
|---|---|---|---|
| [0001](0001-structured-logging-pino.md) Structured logging | Accepted | Pino, created through a small factory in core; logs are newline-delimited JSON. | CLI results go to stdout, diagnostics to stderr; `pino-pretty` is dev-only. |
| [0002](0002-integration-package-layout.md) Integration-package layout | Accepted | One package per integration surface. `@askdb/core` is dialect-agnostic and returns SQL; `ask()` takes an `AskDialect`; engine packages own their dialect, connector, input shape and catalog queries. | No engine code, driver import or executor in core; `@askdb/introspect` stays engine-agnostic. |
| [0003](0003-postgres-partition-handling.md) Postgres partitions | Accepted | Partition leaves are filtered out in the Postgres catalog SQL; the partitioned parent is the canonical table. | Plain `INHERITS` children stay independent tables. |
| [0004](0004-enrichment-package-boundary.md) Enrichment boundary | Accepted (amended 2026-07) | `@askdb/enrich` is the headless authoring layer; Studio and custom surfaces depend on it. | Authoring logic lives in `@askdb/enrich`, not duplicated in Studio or the CLI. |
| [0005](0005-askdb-config-and-env-bootstrap.md) Config and env bootstrap | Accepted | `@askdb/config` (`defineConfig`, `bootstrapAskDbEnv`) loads `.env` and `askdb.config.*` into an in-memory snapshot; `.config/askdb.*` is the alternate location. | Library packages don't read `process.env`; the full config map is not merged into `process.env`. |
| [0006](0006-ai-provider-integration-strategy.md) AI provider integration | Accepted | Core is BYO-model: `ask()` takes any AI SDK `LanguageModel`. `@askdb/ai` owns provider registry and env precedence; provider SDKs live outside core. | Core never depends on `@askdb/ai` or a provider SDK; `@askdb/ai-*` adapters and raw `LanguageModel`s are equally supported. |
| [0007](0007-connector-registry.md) Connector registry | Accepted | `@askdb/connectors` holds the connector registry; engine packages export adapters and apps dispatch through the registry. | Apps don't re-implement per-engine switches. |
| [0009](0009-studio-local-api-protection.md) Studio local API protection | Accepted | Host allowlist on every request, same-origin and JSON checks, and a per-launch in-page session token (synchronizer token), not a Jupyter-style login token. | The token proves same-origin, not identity; keep the Host check, `no-store` and frame denial that its secrecy rests on. |
