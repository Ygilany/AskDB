---
"@askdb/core": minor
"@askdb/docs-site": patch
---

- **Locking reads are rejected on every engine, with a new rule code** (#319). `validateSelectSql`, and so `ask()`, `generateSelectSql()` and `bindPreparedQuery()`, throws `SqlValidationError` with rule `SQL_LOCKING_READ` for `FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE`, `FOR KEY SHARE` and `LOCK IN SHARE MODE` anywhere in the statement, subqueries and CTEs included. On SQL Server, it also rejects the table hints `UPDLOCK`, `XLOCK`, `HOLDLOCK`, `PAGLOCK`, `TABLOCK`, `TABLOCKX`, `ROWLOCK`, `SERIALIZABLE` and `REPEATABLEREAD` as unquoted words anywhere, inside `WITH (…)` or without it. `NOLOCK`, `READUNCOMMITTED`, `READPAST`, `READCOMMITTEDLOCK` and `NOWAIT` still pass. Before, `SELECT … WITH (UPDLOCK)`, `FOR SHARE` and `LOCK IN SHARE MODE` passed, and the host's transaction then held their locks.
- `SqlValidationRuleCode` adds `SQL_LOCKING_READ`, and `buildSelectGuardrailExplanation()`'s `checksVerified` adds `no_locking_reads`.
- On SQL Server, the NL→SQL prompt quotes a schema, table or column named like one of those hints (`[rowlock]`).
- **Upgrade notes (breaking):**
  - `FOR UPDATE` and `FOR NO KEY UPDATE` now throw `SQL_LOCKING_READ`, not `SQL_FORBIDDEN_KEYWORD`. Code that matches the old rule code for them needs the new one.
  - SQL that passed before and now throws: `FOR SHARE`, `FOR KEY SHARE` and `LOCK IN SHARE MODE` on every engine, and the nine SQL Server hints, also on a dialect id that is no built-in engine.
  - On SQL Server (and dialect ids that are no built-in engine), an unquoted name that is one of the nine hint words throws; quote it (`[rowlock]`). `HOLDLOCK` was already a T-SQL reserved word.
  - Code that switches over every `SqlValidationRuleCode` member needs a case for `SQL_LOCKING_READ`.
- Docs: Safety boundaries lists the locking forms and says the check is defense in depth: the connection's isolation level still decides what a plain `SELECT` locks. Troubleshooting has a `SQL_LOCKING_READ` entry, and the check summaries elsewhere name it.
