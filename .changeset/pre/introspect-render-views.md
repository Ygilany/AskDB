---
"@askdb/introspect": patch
---

Include database views in rendered Schema v2 output. Views were already introspected by all four connectors but silently dropped during rendering.
