---
"@askdb/docs-site": patch
---

The upgrade guide's 1.0.0-beta.52 section says beta.52 is released and opens with a security subsection for GHSA-rhwf-7742-8hwj, GHSA-rpcp-322q-q738 and GHSA-cjwq-phcm-mwg7, in their published words. It tells readers to upgrade `@askdb/core` and the packages that pin it, and says SQL Server now refuses a non-ASCII name the schema doesn't spell, such as an alias `[Città]`. The SQL checks reference links the three advisories, and `SECURITY.md` lists them with 1.0.0-beta.52 as the release to upgrade to.
