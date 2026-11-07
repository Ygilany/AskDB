---
"@askdb/docs-site": patch
---

The SQL checks reference and Safety boundaries describe dollar-quoted strings in line with GHSA-rmjw-pffc-5hjr, fixed in 1.0.0-beta.51 (#713): a dollar-quoted string's tag may hold letters beyond ASCII (`$é$ … $é$`), and the tenant check now ends such a string where Postgres does. The advisory's own words are quoted next to GHSA-8pwj-6hfv-5pm4's.
