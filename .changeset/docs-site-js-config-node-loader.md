---
"@askdb/docs-site": patch
---

"Bundle an app that uses AskDB" adds a JavaScript config as a setup that bundles `@askdb/config` with the service, with an example and a new row in its error table, and keeps `@askdb/config` external only for a TypeScript config (#833). The config API reference says which loader each extension uses, and the upgrade guide's beta.52 section names the change for `.js` configs.
