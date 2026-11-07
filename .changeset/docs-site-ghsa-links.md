---
"@askdb/docs-site": patch
---

The SQL checks reference says, in its `$` row and next to GHSA-8pwj-6hfv-5pm4's readings, that since 1.0.0-beta.51 a dollar-quote tag with non-ASCII letters (`$é$ … $é$`) is read as a string, as the engine does (GHSA-rmjw-pffc-5hjr). It links both advisories' upgrade-guide entries (#713).
