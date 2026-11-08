---
"askdb": minor
---

`askdb ask` and `askdb bundle` print each warning `loadSchema()` returns, a tenant policy's included, as one `Warning:` line on stderr, and keep their exit code. Before, neither printed them, so a misplaced or duplicate `columns[]` entry, an orphaned table file, an ignored `sensitive: false`, or a tenant-policy entry for a removed table loaded silently. Stdout is unchanged.
