---
"@askdb/config": minor
"@askdb/prisma": minor
"askdb": patch
---

**Discriminated union types for `ai` and `introspection` in `AskDbConfig`** — each `provider` value now enforces exactly the right `providerConfig` branch at compile time (e.g. `provider: "openai"` requires `providerConfig: { openai: OpenaiConfig }` and rejects any other key). Named branch types are exported: `OpenaiAiConfig`, `AzureAiConfig`, `FoundryAiConfig`, `AnthropicAiConfig`, `GoogleAiConfig`, `AskDbAiConfig`, `PostgresIntrospectionConfig`, `PrismaIntrospectionConfig`, `AskDbIntrospectionConfig`.

**Prisma schema auto-discovery in `@askdb/prisma`** — `discoverPrismaSchemaPath()` is now exported and probes `prisma/schema.prisma`, `schema.prisma`, and `prisma/` (multi-file) in order. Setting `introspection.provider: "prisma"` is now sufficient without an explicit `schemaPath`; the path can still be set via `introspection.providerConfig.prisma.schemaPath` to override discovery.

**`ASKDB_PRISMA_SCHEMA` env var removed** — the Prisma schema path is read from the bootstrapped structured config (`getAskDbRuntimeConfig().introspection.prismaSchemaPath`) instead of a flat env key. `AskDbRuntimeConfig` gains a typed `introspection` field with `provider`, `prismaSchemaPath`, and `outputDir`.

**`RUNTIME_SHELL_FLAT_OVERRIDES` removed from bootstrap** — `askdb.config.*` is now the sole source of truth; use `env("VAR")` inside the config file to read from shell or `.env` at load time.
