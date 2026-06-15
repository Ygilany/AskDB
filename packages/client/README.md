# @askdb/client

Config-aware AskDB facade. Resolves schema, model, and dialect from your runtime config so callers only pass a question.

## Quick start

```ts
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
import { createAiRegistry } from "@askdb/ai";
import { openaiProvider } from "@askdb/ai-openai";
import { createAskDb } from "@askdb/client";

bootstrapAskDbEnv();
const askdb = createAskDb({
  config: getAskDbRuntimeConfig(),
  registry: createAiRegistry([openaiProvider]),
});

const { sql } = await askdb.ask("top 10 customers by revenue");
```

## Per-call overrides

All three resolution axes accept optional per-call overrides:

| Override | Type | Default |
|---|---|---|
| `schema` | `{ path }` \| `{ json }` \| `{ schema }` \| `NormalizedSchema` | From `createAskDb({ schema })` → config `host.schemaPath`/`host.schemaJson` → env |
| `model` | `AskDbLanguageModel` | From registry via config `ai.aiEnv` |
| `dialect` | `AskDialectInput` | Config `dialect` → schema `provider` → `"postgres"` |

```ts
const { sql } = await askdb.ask("count active users", {
  dialect: "mysql",
  schema: { path: "./schemas/prod.schema" },
});
```

## Multi-tenant usage

The schema and model caches are **per-client-instance**. For multi-tenant servers where each tenant has a different schema, either:
- Create one `AskDbClient` per tenant, or
- Pass per-call `schema` and/or `model` overrides (bypasses the cache).

## `reload()`

Drops the cached schema and model so the next `ask()` re-resolves them from config:

```ts
askdb.reload();
```

## `onResolve` hook

Inspect how schema, model, and dialect resolved on each call — useful for logging or debugging:

```ts
const askdb = createAskDb({
  config,
  registry,
  onResolve: ({ dialect, modelSource }) => {
    console.log(`dialect=${dialect.dialect} (${dialect.source}), model=${modelSource}`);
  },
});
```
