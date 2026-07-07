# @askdb/client

Config-aware AskDB facade. Resolves schema, model, and dialect from your runtime config so callers only pass a question.

## Quick start

```ts
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
import { openaiProvider } from "@askdb/ai-openai";
import { createAskDb } from "@askdb/client";

// bootstrapAskDbEnv() reads .env and askdb.config.* into an in-memory snapshot.
// getAskDbRuntimeConfig() then returns a typed view over that snapshot.
// Both calls are needed: bootstrap populates the store; getAskDbRuntimeConfig reads it.
bootstrapAskDbEnv();
const askdb = createAskDb({
  config: getAskDbRuntimeConfig(),
  providers: [openaiProvider], // adapters only — the client builds the AI registry
});

const { sql } = await askdb.ask("top 10 customers by revenue");
```

Pass the adapter(s) for whichever `ai.provider` your config selects. Advanced alternative: build a registry yourself with `createAiRegistry` from `@askdb/ai` and pass it as `registry` instead (e.g. to share one registry across several clients) — exactly one of `providers` or `registry` is required.

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
  providers: [openaiProvider],
  onResolve: ({ dialect, modelSource }) => {
    console.log(`dialect=${dialect.dialect} (${dialect.source}), model=${modelSource}`);
  },
});
```
