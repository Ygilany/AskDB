# ADR 0012 — AskDB's SQL checks are defense in depth; the database is the security and tenant boundary

## Status

Proposed (2026-09-29) in PR #184; merging #184 accepts it. It replaces the "Strict mode fails closed" design decision in `docs/specs/multi-tenancy.md` and the parser-based design in `docs/contracts/tenant-policy.md` ("Guardrail validation").

## Context

AskDB returns SQL and never executes it (`AGENTS.md`, "Conventions"). Before `ask()` returns, it runs three checks on the model's SQL:

- **Read-only checks** (`validateSelectSql`, `packages/core/src/sql/validate.ts`): the first keyword is `SELECT` or `WITH`, there's one statement, there are no comments, no denylisted keyword appears unquoted, and no denylisted function is called. They run on tokens from a dialect-aware lexer (`packages/core/src/sql/lexer.ts`), not on a parse tree.
- **Tenant check** (`validateTenantGuardrails`, `packages/core/src/sql/tenant-guardrail.ts`): each tenant-scoped table named in the SQL comes with its tenant column, join-path columns or `:tenant_*_ids` placeholder somewhere in the statement's code.
- **Sensitive check** (`validateSensitiveReferences`, `packages/core/src/sql/sensitive-guardrail.ts`): sensitive columns and tables named in the SQL or reached through a wildcard are reported.

The recorded design promised more than that:

- `docs/specs/multi-tenancy.md`: "**Strict mode fails closed** — when the guardrail validator cannot prove a query is tenant-safe, it rejects. Prompting alone is not sufficient; SQL validation is the second line of defense." Its feature list described "AST-based Postgres SQL checks" with cross-table scope compatibility.
- `docs/contracts/tenant-policy.md`: "Parser-based validation (primary)" with `node-sql-parser`, and a heuristic fallback that rejects whatever it cannot prove.
- `docs/mission.md`: "non-negotiable tenant scoping in generated and executed queries".

None of the parser work exists. The checks that did ship pass SQL the design said would be rejected: `WHERE tenant_id = … OR 1=1`, and a tenant column that is only selected (#315); wildcards over tables written in some `FROM` forms (#306–#309); a second `SELECT` in a SQL Server batch; and SQL lexed under a different string setting from the server's, such as MySQL `NO_BACKSLASH_ESCAPES` (#340). The independent review behind PR #184 found the docs site, `SECURITY.md` and the contracts describing the design rather than the code.

AskDB also can't see what decides whether a query is safe once it runs: the executing role and its grants, row-level security, which views and functions have side effects, `search_path`, and the server's lexical settings. The host owns all of these (`docs/mission.md`, "Target audience").

So the question is what AskDB's checks are for, and where the boundary sits.

## Options considered

### A. Make AskDB's checks the security boundary

Build what the original design described: a parser per engine, name resolution, and a proof that every tenant-scoped row source is filtered to the caller's scope (or deterministic predicate rewriting, #235, plus a verification step). Every bypass would then be a vulnerability.

- **For:** it matches the original spec and would let AskDB promise tenant isolation to hosts that don't configure the database.
- **Against:** a boundary has to read SQL exactly as the server does. That means one grammar per engine and version, the server's modes (#340 shows even lexing depends on `sql_mode`), extensions, and user-defined functions and views AskDB never sees. Proving tenant scoping for arbitrary `SELECT`s (CTEs, subqueries, `LATERAL`, set operations, views that join across tenants) is research-grade work. Even then, AskDB would be vouching for SQL whose execution it doesn't control. Rejected for now. The door stays open: see "When to revisit".

### B. Checks are a best-effort lint; the database is the boundary (chosen)

Keep the checks, describe them as heuristic defense in depth that catches common model mistakes, and make the database the security and tenant boundary: a least-privilege, read-only role; row-level security or an equivalent per-tenant mechanism; timeouts and row limits. AskDB fails closed only where it owns the mechanism end to end.

- **For:** it matches the code and what AskDB can know. The checks stay useful: they give fast feedback on the mistakes models actually make (a write statement, a stacked statement, a forgotten tenant filter, a sensitive column), and `strict` mode stops those before the host runs anything.
- **Against:** hosts must configure the database. Hosts that relied on the old wording lose a guarantee they never had.

### C. Drop the SQL checks

Return the model's SQL unchecked and document the database as the only control.

- **For:** the most honest option, and less code to maintain.
- **Against:** it throws away cheap, useful catches, and leaves hosts without mature database controls with nothing at all. Studio's Playground **Execute** also uses `validateSelectSql` as one of its guards (ADR 0009, `apps/studio/src/execute-registry.ts`). Rejected.

## Decision

Option B.

1. **The checks are a lint, not a boundary.** Docs call them checks or guardrails and the output "checked SQL". They never call them a security boundary, and never say they guarantee tenant isolation or read-only execution. `SECURITY.md` ("What AskDB guarantees") lists only the mechanical properties the checks do enforce, and says when they hold (a dialect that matches the server's string settings).
2. **The database is the boundary.** The docs lead with the execution-side controls: a least-privilege read-only role, database-level tenant enforcement (Postgres row-level security keyed on a per-request setting, per-tenant views or roles), statement timeouts and row limits (`concepts/safety-boundaries.mdx`, "Run generated SQL safely"; `guides/run-safely-in-prod.mdx`).
3. **AskDB fails closed where it owns the mechanism.** When a tenant policy exists, `ask()` throws without a valid `tenantScope`. It expands a `subtree` scope through the host's resolver or throws. It binds tenant IDs with dialect-aware escaping or driver markers, and throws on a placeholder it can't bind. In `strict` mode it throws when the tenant lint finds a problem. These are AskDB's guarantees; a passing lint isn't.
4. **Bypass reports are hardening fixes.** SQL that gets past a check is in scope and gets fixed, but at hardening severity. A report is more severe when it defeats something AskDB does own (scope validation, ID binding), or when it causes data loss or a cross-tenant leak in an integration that followed the guidance above (`SECURITY.md`, "Scope").
5. **Tightening the lint doesn't move the boundary.** Better checks are welcome: the tenant check on pre-render forms (#315), one decision point for all checks (ADR 0010, #310), deterministic predicate rewriting (#235), a sql_mode-aware MySQL dialect (#340). None of them, on its own, makes the checks a boundary. Relaxing the "not a security boundary" language requires superseding this ADR and updating `docs/contracts/tenant-policy.md` ("Not implemented") in the same PR.

## Consequences

- **Hosts own isolation.** Multi-tenant hosts must enforce tenancy in the database. The multi-tenancy spec lists RLS (or equivalent) as the recommended primary tenant boundary, and the docs site's safety, production and multi-tenancy pages say so.
- **`strict` means something narrower.** It means "throw when the lint finds a problem", not "reject what can't be proven safe". The field name and values don't change (`docs/contracts/tenant-policy.md`).
- **Known gaps are documented, not hidden.** `SECURITY.md` and the docs site list them: the tenant check's `OR 1=1` and select-only cases (tracked in #315), the `FROM` forms the sensitive check misses (#306–#309), server string settings (#340), the SQL Server second-`SELECT` gap, and Postgres catalog visibility.
- **Mission wording changes.** `docs/mission.md` separates what AskDB guarantees (scope required, prompt instructions, ID binding, the lint rejecting or flagging SQL without tenant identifiers) from what the database enforces. `docs/roadmap.md` Phase 13 follows it.
- **Later ADRs build on this.** ADR 0010's Consequences ("Not a stronger guarantee") assumes this stance, and this record is its source.
- **Security triage has a stated policy.** Reporters and maintainers can tell a hardening fix from a vulnerability by the rule in Decision 4.

## When to revisit

- A parser-backed analysis that reads SQL the way each supported server does, including its modes, becomes practical (Option A).
- Deterministic tenant predicate rewriting (#235) lands with a verification step strong enough to state as a guarantee for some class of queries.
- AskDB starts executing SQL on a supported path beyond Studio's local Playground, which would put the execution boundary inside AskDB (today a non-goal: `docs/mission.md`).

## Related

- PR #184 (docs: state the guardrails accurately), ADR 0010 (one decision point for SQL guardrails, #311), ADR 0009 (Studio local API protection).
- #235, #306–#309, #310, #315, #340.
- `SECURITY.md`, `docs/specs/multi-tenancy.md`, `docs/contracts/tenant-policy.md`, `apps/docs-site/src/content/docs/concepts/safety-boundaries.mdx`, `apps/docs-site/src/content/docs/guides/run-safely-in-prod.mdx`.
