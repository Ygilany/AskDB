---
"@askdb/ai-azure": patch
"@askdb/ai-google": patch
"@askdb/ai-openai": patch
"@askdb/ai-anthropic": patch
"@askdb/ai": patch
"@askdb/config": minor
"askdb": patch
---

Fix AI adapter correctness bugs that the AI SDK silently ignored.

**@askdb/ai-azure**: Embedding `dimensions`/`user` are now sent. They were
wrapped under `providerOptions.azure`, but `@ai-sdk/azure` builds embeddings
with `OpenAIEmbeddingModel`, which reads only `providerOptions.openai`, so
they were dropped. `reasoningEffort` now also sets `forceReasoning: true`. The
AI SDK decides whether a model can reason from the model id it was given, which
on Azure is the deployment name. Without this flag, a deployment such as
`askdb-reporting` backed by `modelFamily: "gpt-5"` silently lost its reasoning
effort. The missing-resource error now names the config keys
(`ai.providerConfig.azure.resourceName` / `baseUrl`) and gives the
`AZURE_RESOURCE_NAME` env alternative.

**@askdb/ai-google**: Embeddings use the non-deprecated `google.embedding()`
and now honor `dimensions`, mapped to Gemini's `outputDimensionality`.

**@askdb/ai-openai / @askdb/ai-azure**: Reasoning-model detection no longer
treats `gpt-5-chat*` (non-reasoning chat models) as reasoning models. It now
recognizes gpt-5 point releases and later majors (`gpt-5.1`, `gpt-6`, …).

**@askdb/ai-anthropic**: Reasoning-model detection now follows
`@ai-sdk/anthropic`'s capability table. Claude Sonnet 4.6, Opus 4.6+, and the
5.x models (Opus 5, Sonnet 5, Fable 5, …) get adaptive thinking
(`thinking: { type: "adaptive" }` plus `effort`) instead of the manual
`budgetTokens` form, which newer models reject. Claude Haiku 4.5 now gets
extended thinking.

**@askdb/ai**: `aiKeyMissingMessage` now lists Anthropic.
`aiProviderMissingMessage` maps aliases to the package that owns them (for
example, `foundry` points to `@askdb/ai-azure`). It no longer suggests a
nonexistent `@askdb/ai-<name>` package for custom providers.

**@askdb/config**: `AzureConfig` / `FoundryConfig` gain `resourceName`, which
is flattened to the key the Azure adapter reads. Before this, a config-only
Azure setup couldn't supply a resource name and failed at startup.
`ASKDB_AI_PROVIDERS` now includes `"anthropic"`.

**askdb**: `askdb init --ai-provider azure|foundry` scaffolds
`resourceName: env("AZURE_RESOURCE_NAME")` and adds `AZURE_RESOURCE_NAME=` to
`.env.example`, so the generated config works out of the box.
