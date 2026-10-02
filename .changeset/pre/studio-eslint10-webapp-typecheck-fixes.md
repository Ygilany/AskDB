---
"@askdb/studio": patch
---

Fix several bugs in the Studio web app that were hidden because `tsconfig.web.json` inherited an `exclude` from the root config that silently disabled type-checking for `src/web`:

- Concepts page "Revert" button was calling state setters left over from a pre-`useReducer` refactor and did nothing.
- Removing a tenant policy hierarchy edge removed the wrong row (missing loop index).
- Total token count in the request usage summary could throw on a `null` total; it's now hidden like the other usage rows when unavailable.
- The playground's saved-history `explain` field could be assigned a non-string value.
- Removed the schema table's "Default" column, which never had backing data.

Internal: swapped `eslint-plugin-import` for `eslint-plugin-import-x`, since the former doesn't support ESLint 10.
