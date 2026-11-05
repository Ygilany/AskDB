---
"@askdb/core": patch
---

Make the tenant placeholder helpers `resolvePlaceholders`, `replacePlaceholdersWithLiterals` and `replacePlaceholdersWithParams` module-internal. Only tests used them, and they were never part of the package entry, so no public API changes.
