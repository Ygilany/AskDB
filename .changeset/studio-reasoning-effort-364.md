---
"@askdb/studio": patch
"@askdb/docs-site": patch
---

Studio's tenant-policy suggestion now honours the configured `enrichment` reasoning effort, and Playground sample generation runs on `@askdb/client` instead of re-implementing its model resolution. The Playground now also honours `modes.askdbMode`, as the CLI and HTTP API already do. The docs now list the tenant-policy suggestion under the `enrichment` effort.
