---
"@askdb/core": minor
---

**Breaking:** `placeholderForRoot`, `ENRICHMENT_SYSTEM_PROMPT`, `buildEnrichmentUserPrompt` and `parseCandidates` are no longer exported (#654): nothing outside `@askdb/core` used them, so they leave before 1.0 (ADR 0031). Use `placeholderForTenantRoot(root)` for the first, which `placeholderForRoot` was deprecated for, and `suggestEnrichment()` for the other three, which it runs. The upgrade guide's beta.52 section lists each.
