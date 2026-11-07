---
"@askdb/docs-site": patch
"@askdb/core": patch
---

Document the typed `ai` config sections and the removed config keys (#711, #765). The upgrade guide's beta.50 section shows each removed key and export before and after, and how a host moves from `rt.ai.aiEnv` to the sections. The configuration reference describes `rt.ai.language` and `rt.ai.embedding` and replaces its deprecated-keys table with a short removed-keys note. The bring-your-own-model guide builds the model with `createLanguageModelFromSection` and adds a section for apps without a config file, and the packages reference lists the new `@askdb/ai` exports and the env map's precedence. `@askdb/core`'s README points at `createLanguageModelFromSection`.
