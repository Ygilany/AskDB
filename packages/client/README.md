# @askdb/client

Config-aware AskDB facade. Resolves schema, model, and dialect from your runtime config so callers only pass a question.

## Quick start

```ts
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
import { createAskDb } from "@askdb/client";

// bootstrapAskDbEnv() reads .env and askdb.config.* into an in-memory snapshot.
// getAskDbRuntimeConfig() then returns a typed view over that snapshot.
// Both calls are needed: bootstrap populates the store; getAskDbRuntimeConfig reads it.
bootstrapAskDbEnv();
const askdb = createAskDb({
  config: getAskDbRuntimeConfig(), // ai.provider in askdb.config.* picks the model
});

const { sql } = await askdb.ask("top 10 customers by revenue");
```

Install the AI SDK package for whichever `ai.provider` your config selects — e.g. `npm i @askdb/client @askdb/core @askdb/config ai @ai-sdk/openai` (`@askdb/core` and `ai`, AI SDK 7, are required peers of the client; npm adds them for you, Yarn doesn't). With no `providers`/`registry` option, the client registers every provider built into `@askdb/ai` (OpenAI, Azure/Foundry, Google, Anthropic, Vercel AI Gateway); each loads its `@ai-sdk/*` package only when first used, and a missing one fails with an `npm i @ai-sdk/<provider>` hint.

Options: `providers: ["openai"]` restricts the set to named built-ins, and `AiProviderAdapter` objects add custom providers (`providers: ["openai", myAdapter]`). Advanced alternative: build a registry yourself with `createAiRegistry` from `@askdb/ai` and pass it as `registry` (e.g. to share one registry across several clients). Pass at most one of `providers` or `registry`.

To bypass config-driven model selection entirely, pass an AI SDK `LanguageModel` per call (`askdb.ask(q, { model })`) or call `ask()` from `@askdb/core` directly.

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

## Parameterized output

`askdb.ask()` returns the same `AskPipelineResult` as `@askdb/core`'s `ask()`, including optional `unboundSql`, `params`, `parameters`, and `preparedQuery` when the model complies (default `parameterize: true`). The facade forwards options and returns the core result verbatim, `verdict` included.

```ts
const result = await askdb.ask("How many cities does Colorado have?", { tenantScope });

await pool.query(result.sql);
await pool.query(result.unboundSql!, result.params);

// A new value, no model call.
const rebound = await askdb.bind(result.preparedQuery!, { state_name: "Utah" }, { tenantScope });
await pool.query(rebound.sql);
```

Every `ask()` is still one model call. Set `{ parameterize: false }` to opt out of the extra output tokens. Prefer `params` over `tenantParams` when using the new fields.

`askdb.bind(prepared, values, options?)` wraps `@askdb/core`'s `bindPreparedQuery()`: it checks the stored template under the client's schema (or `options.schema`), the `tenantScope` you pass and the modes (`sensitiveGuardrailMode`, `acceptWarnings`), expands a `subtree` scope with `options.resolveTenantDescendants`, and renders the tenant IDs from the scope. Authorizing that scope remains the host's job, as for `ask()`.

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
  onResolve: ({ dialect, modelSource }) => {
    console.log(`dialect=${dialect.dialect} (${dialect.source}), model=${modelSource}`);
  },
});
```
