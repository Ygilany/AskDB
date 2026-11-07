---
"askdb": patch
---

`askdb ask`'s hint after a schema that doesn't load no longer names `fixtures/schemas/orders-users.schema/`, a folder only AskDB's repository holds (#850). On `Schema path not found.`, `Schema path is not readable (permission denied).`, `Failed to parse schema.` and `Failed to load schema.`, it now says to use a schema directory that `askdb introspect` wrote, and links the troubleshooting guide.
