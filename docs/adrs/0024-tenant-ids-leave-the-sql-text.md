# ADR 0024 — Tenant IDs leave the SQL text by default, and an inlined tenant ID never holds a backslash

## Status

Accepted (2026-11-05). The maintainer chose the default (#231, "Decision (2026-11-05)" in its body, option A). The rest was settled on 2026-11-05 when #231, #360 and #371 were planned together; [#371's Step 3 comment](https://github.com/Ygilany/AskDB/issues/371#issuecomment-6666455938) records the business-value decision. Implemented with `DEFAULT_TENANT_SQL_MODE` and `escapeTenantId` in `packages/core/src/sql/tenant-placeholders.ts`. Contract: [`tenant-policy.md`](../contracts/tenant-policy.md), "Output modes" and "Enforcement rules". It amends [ADR 0012](0012-sql-checks-are-defense-in-depth.md) (Decision 3) and [ADR 0010](0010-sql-guardrail-decision-point.md) (Decision 0's rendering contract).

## Context

ADR 0012 Decision 3 says AskDB owns tenant-ID binding. The checks run on the model's SQL before AskDB renders the tenant IDs (#341), and none of them runs again on the rendered SQL. So rendering must never change the statement's structure.

`ask()` rendered tenant IDs in one of two modes, and `sql-only` was the default:

- **`sql-only`** inlined each ID as a literal, escaped for the dialect: quotes doubled, and backslashes doubled when the dialect's `backslashEscapes` was on. With no dialect at all (a custom `AskDialect`), it only doubled quotes (#360).
- **`sql-params`** replaced each placeholder with the dialect's driver marker and returned the IDs as `tenantParams`.

The literal form keeps the structure only when the dialect reads strings the way the server does. AskDB can't see the server's settings, and the CLI, the HTTP API and Studio can't set `backslashEscapes` at all (#340). The independent review of #184 showed the mismatch: with `standard_conforming_strings = off` on Postgres 17, the tenant ID `x\' OR 1=1 --` rendered as `'x\'' OR 1=1 --'`, and the scoped query returned every row. A custom `AskDialect` aimed at MySQL had the same break-out under MySQL's default settings (#360).

## Decision

1. **The default `tenantSqlMode` is `sql-params`**, exported as `DEFAULT_TENANT_SQL_MODE`. Tenant IDs leave the SQL text: a host runs `sql` with `tenantParams`, or `unboundSql` with `params`. The default is the same for every dialect, so a custom `AskDialect` gets `$N` markers.
2. **Wherever AskDB inlines a tenant ID, it refuses one that contains a backslash**, on every dialect and with no dialect, with `TenantScopeError` (`UNESCAPABLE_TENANT_ID`). Otherwise it only doubles the quotes. A literal with no backslash and its quotes doubled reads the same whether or not the server treats backslash as an escape, on every engine AskDB supports. So an inlined tenant ID keeps the statement's structure whatever the server's string settings are.
3. **Rebind follows rule 2.** The `sql` that `bindPreparedQuery()` returns always inlines the tenant IDs, so a rebind throws `UNESCAPABLE_TENANT_ID` for such an ID. `BoundQuery.sql` stays required.
4. **Business values keep the dialect-match condition.** The values `bindPreparedQuery()` inlines into its `sql` are still escaped for the dialect, and the docs say that a value with a backslash can escape its literal when the dialect doesn't match the server (#340). The docs point hosts at `unboundSql` with `params` for values their users type.

## Options considered

- **Keep `sql-only` as the default and only harden it** (option B on #231). Rejected. The default path would still put tenant IDs into SQL text that no check reads. For values that define a security boundary, binding should be the default and inlining the opt-in.
- **Escape a backslash in a form that every server setting reads the same way.** On Postgres, an `E'…'` literal always reads backslash escapes. MySQL and MariaDB have no such form: a hex literal (`X'…'`) or `CHAR(…)` changes the value's type and collation. Rejected: it needs a literal form for each engine and still has no answer for MySQL.
- **Detect the server's string settings.** Rejected here. Core does no database I/O, and a detected setting can't cover every connection a host opens. #340 tracks letting hosts configure the dialect.
- **Make `BoundQuery.sql` optional, and leave it out for a backslash ID.** Rejected. It changes a public type for every rebind caller, for tenant IDs that are rare (hosts usually use integers, UUIDs or slugs).
- **Refuse backslashes in business values too** (#371, step 3). Rejected. It refuses legitimate values such as `C:\tmp` or `50\%`, and loses the safe `unboundSql` + `params` pair with them. The literals the model writes into `ask()`'s `sql` carry the same dialect-match condition (#340), so the docs keep that condition either way.
- **Keep `sql-only` as the default for a custom `AskDialect` only**, since AskDB doesn't know its driver's markers. Rejected. Two defaults are two rules to document. A `$N` marker that the driver doesn't accept fails loudly, and inlining with no known dialect is the #360 case.

## Consequences

- **Breaking for hosts that pass `tenantScope` without `tenantSqlMode`.** `result.sql` now holds driver markers. Running it without `tenantParams` fails at the driver (Postgres: "there is no parameter $1"; better-sqlite3: "Too few parameter values"; MySQL: a syntax error). It never returns other tenants' rows. The fix: pass `tenantParams`, run `unboundSql` with `params`, or set `tenantSqlMode: "sql-only"`.
- **A custom `AskDialect` on a `?` or `@p` engine** must set `tenantSqlMode: "sql-only"`, or rewrite the markers itself. A later, additive change could let an `AskDialect` declare its marker style.
- **A tenant ID with a backslash works only in `sql-params` mode in `ask()`.** A rebind refuses it.
- **`TenantSqlDialect.backslashEscapes` now steers only how tenant substitution lexes the SQL**, not how it escapes tenant IDs. The internal `escapeSqlLiteralLegacy` is deleted.
- **Hosts that report or forward the mode** (Studio today, the HTTP API in #343) import `DEFAULT_TENANT_SQL_MODE` rather than hard-code a string.
