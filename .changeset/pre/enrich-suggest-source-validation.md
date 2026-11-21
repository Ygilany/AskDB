---
"@askdb/enrich": patch
---

Validate suggest table and column references in `buildSuggestionTarget`: an unknown table or a column that doesn't belong to the requested table throws the new `SuggestSourceNotFoundError`, which Studio maps to HTTP 404 before resolving AI config or creating a model.
