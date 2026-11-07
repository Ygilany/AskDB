---
"@askdb/core": patch
---

The tenant check reads a dollar-quoted string whose tag holds non-ASCII letters (`$é$ … $é$`) the way Postgres, CockroachDB and the shared lexer do. Its scanner read the tag as ASCII-only, so it treated such a string as code, and an `OR` the string hides could sit beside the tenant predicate unseen. The scanner's tag pattern now matches the lexer's.
