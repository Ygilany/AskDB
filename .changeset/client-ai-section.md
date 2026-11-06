---
"@askdb/client": patch
---

`createAskDb` resolves the model and its reasoning effort from the config's typed `ai.language` section (`registry.resolveAiConfigFromSection` and `resolveReasoningEffortFromSection`), since `@askdb/config` no longer builds the `ai.aiEnv` map it read (#711). Nothing changes for a host that only calls `createAskDb`. A host that passes its own `registry` builds it with `@askdb/ai` 0.1.0-beta.11 or newer, which has the section methods. The `reasoningEffort` JSDoc now names `ai.language.reasoning`.
