---
"@askdb/core": patch
---

Schema markdown front-matter is read the same way on every load (#742). `loadSchema()`, `loadSchemaFromJson()`, `parseTableMarkdown()`, `parseConceptsMarkdown()` and `parseTenantPolicyMarkdown()` no longer go through `gray-matter`'s cache. Before, a second parse of the same malformed YAML in one process reported `Invalid <kind> front-matter` instead of `Malformed <kind> front-matter YAML`, and every distinct markdown string read or written (`writeTableMarkdown()` and the other writers included) stayed in memory for the life of the process. A server that accepts per-request schemas (`httpApi.allowSchemaOverride`) no longer grows with each new one. `writeTableMarkdown()`, `writeConceptsMarkdown()` and `writeTenantPolicyMarkdown()` also keep a body that starts with a `---` horizontal rule: before, they read it as front-matter, emptied the body and wrote its characters as front-matter keys.
