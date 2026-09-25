# Security Policy

AskDB is pre-1.0 software that generates SQL from schema context using a language model you supply. The library (`@askdb/core`, `@askdb/client`), the CLI, and the HTTP API return generated SQL and never execute it. The exception is Studio's optional Playground **Execute** action, a local development tool that runs SQL against the database you configure for it (see [Studio execute](#studio-execute) below). Applications that run generated SQL own the approval workflows, database roles, tenant enforcement, network controls, and audit logging around it.

## Security model

### What AskDB guarantees

For SQL returned by `ask()` with a built-in dialect:

- The statement starts with `SELECT` or `WITH`.
- It contains no `;` separating a second statement, and no `--` or `/* */` comments.
- None of a fixed list of write/DDL keywords appears as a whole word outside string literals: `INSERT`, `UPDATE`, `DELETE`, `DROP`, `TRUNCATE`, `ALTER`, `CREATE`, `GRANT`, `REVOKE`, `VACUUM`, `ANALYZE`, `COPY`, `CALL`, plus `ATTACH`/`DETACH`/`PRAGMA`/`REINDEX` for SQLite and `EXEC`/`EXECUTE`/`MERGE`/`OPENROWSET`/`OPENQUERY` for SQL Server.
- When the schema artifact has a tenant policy, `ask()` refuses to run without a `tenantScope`, and, unless the scope is `global`, the tenant check has run. It confirms that each tenant-scoped table named in the SQL comes with its tenant column (or `:tenant_*_ids` placeholder) somewhere in the statement. With `enforcement: strict` a failed check throws; with `warn` the findings are returned in `tenantGuardrail.warnings`.
- When the schema marks tables or columns `sensitive`, the sensitive-reference check has run (unless `sensitiveGuardrailMode: "off"`). It defaults to `warn` (findings returned in `sensitiveGuardrail`); `sensitiveGuardrailMode: "strict"` makes it throw.

These checks run over text after a heuristic string-literal stripper. They are **not a SQL parser**, and they are defense in depth that catches common model mistakes. They are **not a security boundary** against adversarial input.

### What AskDB does not guarantee

- **No parsing or semantic analysis.** AskDB doesn't verify that SQL is syntactically valid, that referenced tables or columns exist, or that a `SELECT` is free of side effects (for example, `SELECT … INTO` or side-effecting functions).
- **No system-schema restrictions.** Queries against `pg_catalog`, `information_schema`, `sys`, and similar schemas are not rejected.
- **No tenant-predicate correctness.** The tenant check confirms a column name is present, not that it filters. `WHERE tenant_id = … OR 1=1` passes. AskDB does not rewrite queries to add tenant filters. `subtree` scopes do not expand descendants yet, and `TenantScope.tenantFilters` is currently ignored.
- **No complete sensitive-column detection.** Explicitly named sensitive columns and `SELECT *` on a table marked sensitive are caught. `SELECT *` on a table that merely contains a sensitive column is not.
- **No protection from prompt injection.** The question text and schema enrichment (descriptions, concepts, tenant-policy prose) are part of the model prompt. Anyone who can write to them can influence the generated SQL.

### What integrators should do

Treat generated SQL as untrusted. Execute it with a least-privilege, read-only database role; enforce tenant isolation in the database (for example, Postgres row-level security); set statement timeouts and row limits; and log every question and generated statement. See [Run generated SQL safely](https://askdb.tools/concepts/safety-boundaries/#run-generated-sql-safely).

### Studio execute

Studio is a local development tool and binds to `127.0.0.1` by default. When execute is configured, its Playground runs the SQL it is given against the configured connection. Postgres and MySQL queries run inside a read-only transaction and SQLite files are opened read-only. SQL Server queries have no read-only wrapper. Point `studio.execute` at a read-only, least-privilege login on a non-production database, and don't expose Studio on a shared network.

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
