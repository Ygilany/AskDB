---
"@askdb/docs-site": patch
---

The upgrade notes' 1.0.0-beta.55 section says beta.55 is released and opens with a security subsection for GHSA-p2v7-pv8j-c264 and GHSA-j363-683j-2pvw, in their published words. It tells readers to upgrade `@askdb/core` and the packages that pin it, links the sections that list the queries now refused, and points to the release's SQL Server TLS note. A new beta.55 note says `ask()` now drops `unboundSql`, `params`, `parameters` and `preparedQuery` whenever they differ from the checked `sql` in a literal, a quoted name, or how tokens join (#359), so a caller that runs them should fall back to `sql`. The SQL checks reference links the two advisories, and `SECURITY.md` lists them with 1.0.0-beta.55 as the release to upgrade to. The `@askdb/core` errors reference adds beta.55's cases to `UNICODE_ESCAPED_IDENTIFIER`: an unquoted name not in NFC once lower-cased, and when the schema's spelling excuses an unquoted name.
