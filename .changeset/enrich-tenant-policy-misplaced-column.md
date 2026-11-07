---
"@askdb/enrich": patch
---

`saveTenantPolicy()` (Studio's Save) refuses a strict tenant policy with a column on another table than its entry's, as `loadSchema()` now does (#836). It passes `normalizeTenantPolicy()` a column ID → table ID map from `schema.json` on disk.
