# Security Policy

AskDB is pre-1.0 software that generates SQL from schema context using a language model you supply. The library (`@askdb/core`, `@askdb/client`), the CLI, and the HTTP API return generated SQL and never execute it. The exception is Studio's optional Playground **Execute** action, a local development tool that is off by default (`studio.execute.enabled`) and, when enabled, runs SQL against the database you configure for it (see [Studio execute](#studio-execute) below). Applications that run generated SQL own the approval workflows, database roles, tenant enforcement, network controls, and audit logging around it.

## Security model

### What AskDB guarantees

For SQL returned by `ask()` with a built-in dialect id or a `DialectSpec` (a custom `AskDialect` must call `validateSelectSql` itself to get the first four):

- The statement starts with `SELECT` or `WITH` (after any opening parentheses).
- It contains no `;` separating a second statement (on SQL Server, which doesn't need `;`, a second statement made of verbs not on the denylist, such as a second `SELECT`, isn't detected), no comments (`--`, `/* */`, and `#` on MySQL/MariaDB), and no string, quoted identifier, or block comment that never closes.
- None of a fixed list of write/DDL keywords appears as an unquoted keyword: `INSERT`, `UPDATE`, `DELETE`, `DROP`, `TRUNCATE`, `ALTER`, `CREATE`, `GRANT`, `REVOKE`, `VACUUM`, `ANALYZE`, `COPY`, `CALL`, `MERGE`, `INTO`, plus `OUTFILE`/`DUMPFILE` for MySQL and MariaDB, `ATTACH`/`DETACH`/`PRAGMA`/`REINDEX` for SQLite, and `EXEC`/`EXECUTE`/`OPENROWSET`/`OPENQUERY`/`WAITFOR`/`SET` and other T-SQL statement verbs for SQL Server.
- It calls none of the dialect's blocked side-effecting functions (for example `pg_sleep`, `set_config`, `dblink`, and `pg_read_file` on Postgres and CockroachDB, `SLEEP` and `LOAD_FILE` on MySQL and MariaDB, `load_extension` on SQLite).
- When the schema artifact has a tenant policy, `ask()` refuses to run without a valid `tenantScope`. A `subtree` scope is expanded through the host's `resolveTenantDescendants` callback or `ask()` throws. A tenant placeholder AskDB can't bind throws instead of being returned raw. Unless the scope is `global`, the tenant check has run on the SQL returned. It confirms that each tenant-scoped table named in the SQL comes with its tenant column somewhere in the statement's code (not inside a string literal or comment). With `enforcement: strict` a failed check throws; with `warn` the findings are returned in `tenantGuardrail.warnings`.
- When the schema marks tables or columns `sensitive`, the sensitive-reference check has run (unless `sensitiveGuardrailMode: "off"`). It defaults to `warn` (findings returned in `sensitiveGuardrail`); `sensitiveGuardrailMode: "strict"` makes it throw.

These checks split the SQL into tokens the way the target engine reads it, then look for keywords, function calls, and identifiers. They are **not a SQL parser**, and they are defense in depth that catches common model mistakes. They are **not a security boundary** against adversarial input.

### What AskDB does not guarantee

- **No parsing or semantic analysis.** AskDB doesn't verify that SQL is syntactically valid, that referenced tables or columns exist, or that a `SELECT` is free of side effects. The function denylist covers known built-in functions only; a call to one of your own functions that writes, or a locking read such as `FOR SHARE`, passes.
- **No system-schema restrictions.** Queries against `pg_catalog`, `information_schema`, `sys`, and similar schemas are not rejected.
- **No tenant-predicate correctness.** The tenant check confirms a column name is present, not that it filters. `WHERE tenant_id = … OR 1=1` passes, and so does a query that only selects the tenant column. AskDB does not rewrite queries to add tenant filters. AskDB trusts the IDs your `tenantScope` and `resolveTenantDescendants` callback supply.
- **No complete sensitive-column detection.** Sensitive columns named in the SQL, sensitive tables in `FROM`/`JOIN`, and sensitive columns reached through `SELECT *`, `t.*`, or a whole-row reference are reported. A table written in some `FROM` forms is missed, so a wildcard over it goes unreported: a parenthesized `FROM` item (#306), a comma-joined table after a `JOIN`'s `ON`/`USING` (#307), MySQL `STRAIGHT_JOIN` used as a join (#308), and Postgres `TABLE t` inside a derived table (#309).
- **No protection from prompt injection.** The question text and schema enrichment (descriptions, concepts, tenant-policy prose) are part of the model prompt. Anyone who can write to them can influence the generated SQL.

### What integrators should do

Treat generated SQL as untrusted. Execute it with a least-privilege, read-only database role; enforce tenant isolation in the database (for example, Postgres row-level security); set statement timeouts and row limits; and log every question and generated statement. See [Run generated SQL safely](https://askdb.tools/concepts/safety-boundaries/#run-generated-sql-safely).

### Studio execute

Studio is a local development tool and binds to `127.0.0.1` by default. Its Playground **Execute** action is off by default (`studio.execute.enabled`). When enabled, Studio validates each query with `validateSelectSql` for the execute engine's dialect. It runs the query in a read-only transaction (SQLite: a read-only file handle; SQL Server: an always-rolled-back transaction) with a row cap and, except on SQLite, a statement timeout. Studio's API also requires a per-launch session token and checks the `Host` and `Origin` headers, so other websites open in your browser can't drive it. These guards are defense in depth, not a sandbox. Point `studio.execute` at a read-only, least-privilege database role on a non-production database, and don't expose Studio on a shared network. See the [Studio security model](https://askdb.tools/studio/#security-model).

## Reporting a Vulnerability

Please report suspected security issues privately by opening a GitHub security advisory for this repository, if available. If private advisories are unavailable, open a minimal public issue that says you have a security report without including exploit details.

Include:

- Affected package or app.
- Version, commit, or branch.
- Reproduction steps.
- Expected and actual impact.
- Any relevant schema or request shape, with secrets and customer data removed.

Do not include API keys, database credentials, production connection strings, or private schema details in reports.

## Scope

Security-sensitive areas include SQL validation, schema handling, prompt construction, sensitive-field omission, tenant-scope validation and binding, local HTTP surfaces (the HTTP API and Studio, including Studio execute), package publishing, dependency supply chain, and any path that could expose secrets or user data.

**Guardrail bypasses are in scope.** SQL that gets past a check it should fail is a bug we want to hear about: for example, a write keyword hidden from the keyword check, a second statement that isn't detected, a tenant-scoped table that passes without its tenant column, or tenant IDs bound incorrectly. Please report them through the channels above. Because the guardrails are documented as defense in depth rather than a security boundary, we treat most bypasses as hardening fixes, not critical vulnerabilities. A bypass is more severe when it defeats a boundary AskDB does own, such as scope validation or ID binding, or when it lets an integration that followed the guidance above lose data or leak it across tenants.

Out of scope: reports that depend only on generated SQL being executed without the controls in [What integrators should do](#what-integrators-should-do), such as with a privileged role or without database-level tenant enforcement. Model output quality (incorrect but harmless SQL) is also out of scope.

## Supported Versions

Until AskDB reaches 1.0, security fixes target the latest public release and `main`.
