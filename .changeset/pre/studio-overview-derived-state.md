---
"@askdb/studio": patch
---

Studio's Overview counts and suggestions now match the state (closes #1053, closes #1054).

- **One rule for "enriched".** The Overview's `enriched` and `partial` counts, `tables to go`, the pending list, and the Tables list's **Complete**, **Partial** and **Not started** filters now share one rule. A table is complete once it and every column have a description, and partial once anything is written for it or a column (a description, alias, tag, primary entity, business vocabulary, example questions, or a column's alias or enum notes). A table with aliases and every column described, but no description, used to count as enriched on the Overview while the pending list still showed it. It now counts as partial everywhere.
- **"Rebuild index".** Suggested next actions offers **Rebuild index** only once an index exists and is stale. With no index, it used to offer both **Build** and **Rebuild**.
