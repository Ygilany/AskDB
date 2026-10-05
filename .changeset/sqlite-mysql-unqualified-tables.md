---
"@askdb/core": patch
"@askdb/sqlite": patch
"@askdb/mysql": patch
---

On SQLite, MySQL and MariaDB, the NL→SQL prompt `ask()` sends no longer names tables `public.<table>`. Their connectors file the database's tables under `public` to keep table ids stable across engines, and the prompt printed that label as if it were a schema, so models wrote `FROM public.agency`, which the engine refuses (`no such table: public.agency` on SQLite; MySQL reads `public` as a database name). When `public` is the schema's only namespace, its tables are now listed unqualified (`TABLE agency`), and the rule about qualifying table names tells the model never to write `public.<table>`. A MySQL database list stays qualified (`TABLE sales.orders`), including a database actually named `public`. Postgres, CockroachDB and SQL Server prompts are unchanged, and so are table ids, so committed schema artifacts, tenant policies and RAG indexes need no change.

`DialectSpec` gains an optional `unqualifiedNamespace` field that drives this; the built-in SQLite, MySQL and MariaDB specs set it to the new exported `SINGLE_NAMESPACE_LABEL` (`"public"`), which the SQLite and MySQL connectors now use for their namespace too, and a spec that spreads one of them keeps it. `AskDialectGenerateOptions` and `generateSelectSql`'s deps gain `prebuiltDdlUnqualifiedNamespace`, which `ask()` sets next to `prebuiltDdl` so a custom `AskDialect` that forwards both to `generateSelectSql` gets an identifier rule that matches the retrieved DDL.
