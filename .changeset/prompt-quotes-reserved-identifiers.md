---
"@askdb/core": patch
---

The NL→SQL prompt `ask()` sends now lists a schema, table or column whose name is one of the engine's reserved words quoted the engine's way: `TABLE billing."order"` on Postgres and CockroachDB, ``TABLE billing.`order` `` on MySQL and MariaDB, `TABLE billing.[order]` on SQL Server and `TABLE "order"` on SQLite, and the same on column lines. Models copied the bare listing and wrote `JOIN order o`, which SQLite and SQL Server refuse. Three more kinds of name are quoted the same way:

- A word AskDB's own SQL checks reject unquoted (a column named `copy`, or `set` on SQL Server), which a model copying the listing would otherwise write bare and have rejected.
- A name that isn't a plain identifier (a space, a hyphen, a leading digit).
- On Postgres and CockroachDB, which fold unquoted names to lowercase, a name with capitals: a Prisma table `Post` with a `createdAt` column is listed as `public."Post"` and `"createdAt"` (before, a model copying `Post` got `relation "post" does not exist`).

Each engine family has its own reserved-word list, taken from its docs and checked against PostgreSQL 17, MySQL 8.4 and MariaDB 11.4 servers, set on the built-in spec as the new optional `DialectSpec.reservedWords`; a spec that spreads a built-in keeps it, and one that sets the field replaces it. The quote characters follow `id`. The full schema and the retrieved (`retriever`) schema are listed the same way. Schemas without reserved or unusual names (or, on Postgres and CockroachDB, capitals) produce the same schema block as before.

Where the prompt lists tables with their schema (Postgres, CockroachDB, SQL Server, and MySQL or MariaDB with several databases), it gains one rule: when you quote a qualified name, quote each part separately (`"schema"."table"`), with the dialect's own quotes. Models quoted the whole dotted name (`` `org.program` ``), which MySQL reads as a table named `org.program` in the connection's database. The rule shows only the right form: with the wrong form added as a counter-example, `gpt-4o-mini` wrote it more often.

`promptIdentifierQuoter(dialect)` is exported, and `formatSchemaV2ForNlToSql` and `synthesizeRetrievedDdl` accept it as `quoteIdentifier`; without it they list names as stored, as before. Table ids, schema artifacts, tenant policies and RAG indexes are unchanged. The tenant and sensitive-field checks already read quoted names part by part.
