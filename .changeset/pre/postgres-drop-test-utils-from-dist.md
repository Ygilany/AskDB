---
"@askdb/postgres": patch
---
The published `dist/` no longer includes the connector's snapshot test helper (`connector/test-utils.js`). It was never reachable through the package `exports`, so there is no API change.
