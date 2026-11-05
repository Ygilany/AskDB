---
"@askdb/studio": patch
---

Studio's AI tenant-policy draft (**Draft with AI**, `POST /api/suggest-tenant-policy`) no longer sends sensitive column names the operator asked to withhold. It now builds its prompt from the loaded schema with the same formatter as `ask()`, so a column marked sensitive in `schema.json`, escalated by table front-matter, or inherited from a sensitive table is tagged `(sensitive)` by default and left out when `modes.omitSensitiveFromPrompt` is on. A foreign key is sent only when both of its columns are, and the draft sends no descriptions or untracked tables. When omission leaves out a primary or foreign key, the response's new `warnings` list names it and the review screen shows it, so you can add it to the policy by hand (#324).
