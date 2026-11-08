---
"@askdb/ai": minor
---

**Breaking:** `aiKeyMissingMessage`, `aiProviderMissingMessage` and `isReasoningEffort` are no longer exported (#654): nothing outside `@askdb/ai` used them, so they leave before 1.0 (ADR 0031). Use a registry's `keyMissingMessage(context)` for the first; the registry throws the second's message itself, and `hasProvider(provider)` checks first; check a string against `REASONING_EFFORTS` for the third. The upgrade guide's beta.52 section lists each.
