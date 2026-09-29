---
"@askdb/sqlite": patch
---

Fix two SQLite introspection bugs:

- **Implicit FK targets.** A foreign key declared without a column list (`author_id INTEGER REFERENCES authors`) targets the parent's primary key, but `pragma_foreign_key_list` reports `to` as NULL and the connector fell back to the *child* column name — rendering `authors.author_id` instead of `authors.id`. It now resolves the parent table's PK columns (in PK ordinal order, case-insensitive table match).
- **User tables dropped by the internal-object filter.** `name NOT LIKE 'sqlite_%'` treats `_` as a wildcard and matches case-insensitively, so tables such as `SqliteUsers` were silently excluded. The filter is now `substr(name, 1, 7) <> 'sqlite_'`.

Also corrects the `pragma_index_list.origin` comment (`c` = CREATE INDEX, `u` = UNIQUE constraint, `pk` = PRIMARY KEY); behavior was already correct.
