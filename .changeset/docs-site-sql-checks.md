---
"@askdb/docs-site": patch
---

The SQL checks get one reference and one how-to, and Safety boundaries keeps only the explanation (#713). The new SQL checks reference says when the read-only, tenant and sensitive checks run, how each reads SQL on every engine (strings, backslashes, quoted names, comments, where a `--` comment ends, and `$`), and what each rejects, with a diagram. It quotes GHSA-8pwj-6hfv-5pm4's readings, fixed in 1.0.0-beta.50. The new how-to, Match your server's string settings, finds the server's setting and sets `backslashEscapes` to match. Troubleshooting's SQL rule sections and `TenantGuardrailError`, and the core API pages, now link these homes instead of restating their rules.
