---
"@askdb/docs-site": patch
---

New how-to, Introspect without a connection (`guides/introspect-without-a-connection`), under Guides → Build (#713). It walks through building a Postgres schema artifact from exported catalog query results: print the 12 queries, replace their `$1` and `$2` schema filters, run them with `psql --csv`, and introspect with `--from-export`. It says what the export holds (catalog metadata, including the SQL text of definitions and comments) and what it doesn't (table rows, row counts, credentials), and lists the errors and their fixes. The CLI reference now says the queries take the two filter parameters, and the Introspection API reference gives the CSV and JSON rules for export files.
