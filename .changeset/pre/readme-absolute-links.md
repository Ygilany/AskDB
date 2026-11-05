---
"@askdb/introspect": patch
"@askdb/postgres": patch
---

The package READMEs link to ADR 0003, ADR 0011 and the connector authoring guide with absolute GitHub URLs. The old `../../docs/…` links pointed outside the package, so they were dead wherever the README is read from the installed package.
