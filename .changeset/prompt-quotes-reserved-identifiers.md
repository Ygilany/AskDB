---
"@askdb/core": patch
---

The NL→SQL prompt `ask()` sends now lists a schema, table or column whose name is one of the engine's reserved words quoted the engine's way: `TABLE billing."order"` on Postgres and CockroachDB, ``TABLE billing.`order` `` on MySQL and MariaDB, `TABLE billing.[order]` on SQL Server and `TABLE "order"` on SQLite, and the same on column lines. Names that aren't plain identifiers (a space, a hyphen, a leading digit) are quoted too. Models copied the bare listing and wrote `JOIN order o`, which SQLite and SQL Server refuse. Each engine family has its own reserved-word list, taken from its docs, and a `DialectSpec` uses the list and quotes of its `id`. The full schema and the retrieved (`retriever`) schema are listed the same way. Schemas without reserved or unusual names produce the same schema block as before.

Where the prompt lists tables with their schema (Postgres, CockroachDB, SQL Server, and MySQL or MariaDB with several databases), it gains one rule: when you quote a qualified name, quote each part separately (`"schema"."table"`), with the dialect's own quotes. Models quoted the whole dotted name (`` `org.program` ``), which MySQL reads as a table named `org.program` in the connection's database. The rule shows only the right form: with the wrong form added as a counter-example, `gpt-4o-mini` wrote it more often.

`promptIdentifierQuoter(dialect)` is exported, and `formatSchemaV2ForNlToSql` and `synthesizeRetrievedDdl` accept it as `quoteIdentifier`; without it they list names as stored, as before. Table ids, schema artifacts, tenant policies and RAG indexes are unchanged. The tenant and sensitive-field checks already read quoted names part by part.
