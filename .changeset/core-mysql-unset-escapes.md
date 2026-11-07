---
"@askdb/core": patch
---

The tenant check reads a MySQL or MariaDB dialect that leaves `backslashEscapes` unset with backslash escapes on, the server's default, as the shared lexer and the other checks already did. It read such a dialect with escapes off, so it could take a predicate the server reads as part of a string for code. The built-in `mysql` and `mariadb` dialects set the field and aren't affected.
