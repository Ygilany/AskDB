---
"@askdb/ai": minor
"@askdb/ai-openai": minor
"@askdb/ai-google": minor
"@askdb/ai-azure": minor
"@askdb/ai-anthropic": minor
"@askdb/core": minor
"@askdb/config": minor
"@askdb/client": minor
"@askdb/studio": minor
---

Add provider-portable reasoning/latency effort controls for AskDB model calls.

Set `reasoningEffort: "minimal" | "low" | "medium" | "high"` via `@askdb/ai`'s
`resolveProviderOptions(config, { reasoningEffort })` and each `@askdb/ai-*`
adapter maps it to the provider's native knob — OpenAI/Azure
`providerOptions.openai.reasoningEffort`, Google Gemini 3.x
`thinkingConfig.thinkingLevel`, Gemini 2.5 `thinkingConfig.thinkingBudget`,
Anthropic extended `thinking`. Adapters skip models that don't support
reasoning tuning, so unsupported providerOptions are never sent.

`@askdb/core`'s `ask()`, `generateSelectSql()`, and `suggestEnrichment()` gain
an opaque `providerOptions` passthrough forwarded verbatim to `generateText`
— core stays BYO-model and does not interpret it. Unset, behavior is
unchanged.

`askdb.config.*` gains an `ai.reasoning` block (`effort`, `nlToSql`,
`enrichment`) for per-call-site defaults, flattened to
`ASKDB_AI_REASONING_EFFORT[_NL_TO_SQL|_ENRICHMENT]` env vars.

`@askdb/client`'s `createAskDb`/`ask()` now resolve `ai.reasoning` and apply
it automatically — no manual wiring required for the common client/CLI/HTTP
API path. `CreateAskDbOptions.reasoningEffort` sets a client-level default;
`AskOverrides.reasoningEffort` overrides it per call. Studio's sample-question
and enrichment-suggestion endpoints resolve and forward reasoning effort the
same way.

Azure/Foundry deployments are identified by an arbitrary deployment name that
may not match the underlying model id, so reasoning-model detection can't
always rely on `model` alone. Set `providerConfig.azure.modelFamily` (or
`ASKDB_AI_AZURE_MODEL_FAMILY`) to the real model id (e.g. `"gpt-5"`) to
declare it explicitly when the deployment name doesn't already look like one.
