---
"@askdb/client": minor
---

`createAskDb` resolves the model and its reasoning effort from the config's typed `ai.language` section (`registry.resolveAiConfigFromSection` and `resolveReasoningEffortFromSection`), since `@askdb/config` no longer builds the `ai.aiEnv` map it read (#711). A host that only calls `createAskDb` needs no code change, but its config must load under `@askdb/config` 1.0.0-beta.19, which removes the deprecated keys (#765). A host that passes its own `registry` builds it with `@askdb/ai` 0.1.0-beta.11 or newer, which has the section methods. With an older registry, the first `ask()` that needs the config's model throws `ModelNotConfiguredError` naming the older `@askdb/ai` and the fix, instead of a `TypeError`. A host that builds the runtime config itself passes `ai.language` with a typed `connection` object. The `reasoningEffort` JSDoc now names `ai.language.reasoning`.
