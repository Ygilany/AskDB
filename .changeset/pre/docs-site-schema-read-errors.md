---
"@askdb/docs-site": patch
---

The troubleshooting page adds entries for `askdb ask`'s `Schema path is not readable (permission denied).` and `Failed to load schema.`, which the CLI's schema-path hint links to (#850). The first says which permissions the files and directories need, and that an unreadable schema directory prints `Failed to parse schema.` instead.
