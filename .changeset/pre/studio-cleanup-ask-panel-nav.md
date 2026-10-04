---
"@askdb/studio": patch
---

Remove duplicate Ask panel from the right inspector and add multi-tenancy to the docs-site sidebar.

The Ask/generate-SQL workflow now lives exclusively in the Playground view. The right-side inspector panel is simplified to two tabs — RAG and Status — and the `AskPanel` component is removed. The `Bot` icon import and the `"ask"` `PanelKey` are also dropped.

The multi-tenancy docs page (`/multi-tenancy/`) is now linked from the docs-site sidebar under Reference, making it discoverable through navigation.
