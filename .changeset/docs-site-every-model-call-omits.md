---
"@askdb/docs-site": patch
---

The Studio page says how the Playground and **Suggest** treat sensitive columns under `modes.omitSensitiveFromPrompt`, and what a suggestion sends the model. The core API reference documents `suggestEnrichment()`, its `omitSensitiveIdentifiersFromPrompt` option and `SensitiveEnrichmentTargetError`. The privacy model says the setting covers every prompt AskDB sends to a language model, Studio's included, and the modes concept and the production-safety guide name the tenant policy as the one exception to omission (#601, #624, #625).
