---
"@askdb/core": patch
---

The package description and README no longer call `@askdb/core` dialect-agnostic. Core owns the six built-in dialects, so `ask({ dialect: "postgres" })` needs no engine package; the README's minimal example now passes the id (ADR 0029).
