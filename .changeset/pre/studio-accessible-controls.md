---
"@askdb/studio": patch
---

Studio's form controls have names of their own, and the mouse-only ones work from the keyboard (closes #1048, closes #1049, closes #1052).

- **Tables › Enrichment:** each field's label names its control, and a column's fields carry the column (`Description for email`). Each `Suggest` button and drafts group names its field (`Suggest Description for email`, `Drafts for Description for email`). Clicking a label now focuses its field.
- **Tables › Sensitivity:** each column's override is `Sensitivity override for <column>`.
- **Tenancy review:** the `×` buttons say what they remove (`Remove scoped table <id>`), each root's `Label` names its root, and the body is `Policy body`.
- **Concepts:** a link chip's remove button is `Remove link to <table>`, works with Enter and Space, and leaves focus in the links search. The concept's own button is `Remove concept`. Typing in the links search reopens its list after a pick.
- **Overview:** each pending table's `Enrich` is a link, `Enrich <schema>.<table>`, so you can reach it from the keyboard.
- **Primary entity** keeps its spaces as you type. Typing `Customer Account` key by key used to give `CustomerAccount`.
