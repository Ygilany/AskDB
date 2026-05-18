---
"@askdb/studio": patch
---

Fix alias, tags, and enum fields in the studio to allow spaces and multi-word entries. Previously, spaces were stripped and commas swallowed on every keystroke because `parseList` ran inside `onChange`. A new `ListInput` component holds the raw string locally and only parses on blur. AI suggestions now append to existing values rather than replacing them.
