---
"@askdb/ai": minor
"@askdb/ai-openai": minor
"@askdb/ai-google": minor
"@askdb/ai-azure": minor
"@askdb/ai-anthropic": minor
"@askdb/core": minor
"@askdb/config": minor
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
