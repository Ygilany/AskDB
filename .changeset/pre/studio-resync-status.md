---
"@askdb/studio": patch
---

Studio's **Resync schema** now shows its result: `Re-introspected <n> tables from <engine> — enrichment preserved.`, or the error when introspection fails. The Overview used to reload the whole workspace behind a full-page loading screen, which remounted the page and dropped the message, the Playground's question and results, and any unsaved table edits. A resync now refreshes the workspace in place and keeps unsaved edits (closes #1045).
