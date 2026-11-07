---
"@askdb/core": minor
---

**Breaking:** the deprecated `placeholderForRoot` is removed, and `ENRICHMENT_SYSTEM_PROMPT`, `buildEnrichmentUserPrompt` and `parseCandidates` are no longer exported (#654): nothing outside `@askdb/core` used them, so they leave before 1.0 (ADR 0031). Use `placeholderForTenantRoot(root)`, which `placeholderForRoot` was deprecated for, and `suggestEnrichment()`, which runs the other three. The upgrade guide's beta.52 section lists each.
