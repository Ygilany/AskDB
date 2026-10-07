# ADR 0010 — One decision point for SQL guardrails, enforced where SQL is returned and where it is reused

## Status

Accepted (2026-10-07). Proposed 2026-09-27, revised 2026-09-29 after two independent review rounds, and brought up to date with `main` on 2026-10-07. The maintainer chose the direction first: checks are pure rules, one decision point owns the modes, and enforcement points act on its verdict. On 2026-10-07 the maintainer settled the two remaining questions: **reuse is enforced by re-checking at rebind, with no stored verdict** (see "Enforcing reuse"), and **`ask()` rejects a `global`-scope answer that still has a tenant placeholder**, the same rule as the binder (see "`global` answers with tenant placeholders"). Re-checking at rebind reverses a design-review decision recorded in plan 033 (see "What this reverses").

Implementation is tracked in #310. Stage (a) of the plan below is done: #341 (fixing #315) moved the tenant check to the pre-render forms. PRs #186, #197 and #192, which this ADR originally waited for, have merged. ADR 0012 records the stance this ADR assumes: AskDB's checks are defense in depth, and the database is the security and tenant boundary.

## Context

`ask()` runs three checks on model-generated SQL. Each is wired separately, with its own mode vocabulary and its own result shape (as of `main` at `476aaeac`, after #341 and #375):

| Check | Where the mode comes from | Modes | How a failure surfaces | Where it is wired |
|---|---|---|---|---|
| Read-only validator (`validateSelectSql`) | nowhere (always on) | none | on the bound SQL, throws `SqlValidationError`; on the model's `sql-unbound` block, drops the reuse artifacts instead (`generate.ts`, `tryParseParameterizedExtras`) | the built-in / `DialectSpec` generate path, on the model's reply before tenant substitution; `bindPreparedQuery()` again on both rebound forms (`bind.ts`); custom `AskDialect`s must call it themselves (they may target non-SELECT SQL) |
| Sensitive columns (`validateSensitiveReferences`) | `ask()` option `sensitiveGuardrailMode`, default `warn` | `off` / `warn` / `strict` | `result.sensitiveGuardrail`, or throws `SensitiveReferenceError` | `applySensitiveGuardrail()` in `ask.ts`, on `result.sql` only, after tenant substitution; not in `generateSelectSql()`; not at rebind (hosts are told to call it on replay paths) |
| Tenant (`validateTenantGuardrails`) | tenant policy front matter `enforcement` | `warn` / `strict` | `result.tenantGuardrail`, or throws `TenantGuardrailError` | `enforceTenantGuardrails()` (`tenant-guardrail.ts`), called from `ask.ts` on the model's `sql` and `sql-unbound` block **before** tenant substitution (since #341), and from the public `generateSelectSql()` on the same forms; not at rebind |

The **reuse artifacts** (`preparedQuery`, `unboundSql`, `params`, `parameters`) exist so a host can re-run the same question with different values without calling the model again: `bindPreparedQuery(result.preparedQuery, values)` is a local rebind, and tenant IDs are `:tenant_*` placeholders the host supplies on every rebind. `ask()` produces them only on the built-in / `DialectSpec` path (a custom `AskDialect` never gets them). It doesn't produce them when:

- the caller passes `parameterize: false`;
- the model's manifest has no parameters: `ask()` builds reuse artifacts only when it has at least one business parameter (`ask.ts`), so a question with no parameterized values never gets a `preparedQuery`.

It drops them, keeping `sql`, when:

- the model's `sql-unbound` block is missing, fails `validateSelectSql`, or its parameter manifest is invalid (`generate.ts`);
- the template, bound with the manifest values, is not `sqlStructurallyEqual` to the model's `sql`, or that consistency bind throws (`ask.ts`);
- in `sql-params` mode, the tenant markers can't be aligned with the business params (`ask.ts`, `bindTenantIntoUnboundSql`).

This per-path wiring has produced bugs of the same shape:

- **F2 (fixed in #186):** the tenant check ran on different SQL than `ask()` returned, so unscoped SQL came back with `tenantGuardrail.passed: true`.
- **F5 (fixed in #186):** custom dialects skipped the tenant check entirely.
- During the merge of `main`'s subtree support (#270) into #186, the guardrail was still reading `options.tenantScope` instead of the expanded scope the SQL was bound with.
- **#315 (fixed in #341):** the tenant check ran on the rendered forms, where the placeholder had already become `'2'`, `$1`, `?` or `@p0`. The check couldn't tell AskDB's own `agency_id = '2'` from a model-written `agency_id = 2`, and each rule would have had to be written per output mode × dialect × form. That is why it fell back to a name-presence test, and why strict mode returned SQL whose filter didn't filter. #341 applied decision 0 below to the tenant check alone.

The sensitive check reading only `result.sql` looks like the same shape, but it is not a live gap. `unboundSql` and `preparedQuery` are kept only when the template, bound with the manifest values, is `sqlStructurallyEqual` to the model's `sql`, and that comparison normalizes only whitespace, letter case and a trailing `;` (`bind.ts`). Both forms must also pass `validateSelectSql`, which rejects comments. So the template names the same identifiers as `sql`, and the sensitive check matches identifiers case-insensitively. No input reaches a sensitive finding that exists only in the template (short of a schema whose identifiers differ only by whitespace inside quotes).

The review of #186 raised the requirement that triggered this ADR. In `warn` mode, a query that fails a check is returned with the warning, but its `preparedQuery` can be cached and rebound indefinitely with no model call. On every rebind `bindPreparedQuery()` re-runs only the read-only validator; the tenant and sensitive checks don't run. So a tenant or sensitive warning is seen once and the template is reused forever. Fixing that per check, in today's structure, would repeat the logic for the tenant and sensitive checks, and again for every future check or mode.

## Decision

Separate *checking* from *deciding* from *enforcing* (the policy-decision-point / policy-enforcement-point split used in access control). The work is staged:

- **(a) #315, done in #341:** move the tenant check to the pre-render forms and tighten its rules (decision 0).
- **(b) #310:** this ADR's decision point and enforcement points (decisions 1–5).
- **(c)** Extract the shared analysis (decision 1b), and move the read-only and sensitive checks onto it.
- **(d) Later:** a deterministic predicate rewrite (#235) or a real parser, behind the analysis interface.

### 0. Checks evaluate the untrusted forms, before rendering

The untrusted input is the model's reply. Checks run on it before AskDB renders it. On `main` the read-only and tenant checks already do (the tenant check since #341); the sensitive check still reads the rendered `result.sql` and moves in #310:

- `sql`: the model's bound SQL, with the named `:tenant_…_ids` placeholders still in place.
- `template`: the model's `sql-unbound` block, when kept. It is exactly the string `ask()` returns as `preparedQuery.namedSql`, so at rebind the template is the candidate.

Rendering is AskDB's own deterministic code and runs after `decide`: tenant substitution (`resolveTenantSql`, per `tenantSqlMode` and dialect) and binding (`bindPreparedQuery`'s literals and driver markers). It gets its own contract, listing everything rendering may change. ADR 0012 (Decision 3) states the same contract as "rendering must never change the statement's structure"; the list below is what that means precisely:

- A placeholder becomes an escaped literal, a literal list, or a driver marker. A literal is escaped to match the dialect's string settings; when those differ from the server's, a backslash in a value can escape its literal (#371, open; `sql-only` tenant IDs are rejected only when the dialect leaves `backslashEscapes` unset). Driver markers don't have this limit.
- The comparison operator directly around a placeholder may be rewritten to its list form, and only in these ways:
  - tenant substitution (`tenant-placeholders.ts`, `planEdit`): with several IDs, `=` (and SQLite `==`) becomes `IN (…)` and `!=` / `<>` become `NOT IN (…)`; `= ANY(…)` / `= SOME(…)` becomes `IN (…)` and `<> ALL(…)` / `!= ALL(…)` becomes `NOT IN (…)`;
  - binding with array list binding (`bind.ts`, Postgres/CockroachDB): `IN (:x)` becomes `= ANY($n)` and `NOT IN (:x)` becomes `<> ALL($n)` in `unboundSql`, and `= ANY(:x)` becomes `IN (…)` in `sql`.
- Any other operator in front of a multi-ID placeholder throws (`UNSUPPORTED_TENANT_PREDICATE`, `INVALID_LIST_CONTEXT`) instead of being rewritten.
- Nothing else changes: tables, joins, other predicates, and the `AND` / `OR` / parenthesis structure stay as the model wrote them.

Each allowed rewrite keeps the predicate's meaning (membership in the given value set). The tenant rule (#341) counts `col = :p`, `:p = col`, `col IN (:p)` and `col = ANY(:p)` as a filter; the other forms rendering can rewrite (SQLite `==`, `= SOME(…)` and the negated forms) don't count as one, so the check never depends on a rewrite it doesn't recognize. That contract is tested on its own, and by the consumer lab's hostile-ID escaping test (#321). `bindPreparedQuery()` keeps running `validateSelectSql` on its rendered output as an assertion of that contract, not as the check.

With this, F2 is removed by construction: the returned forms differ from the checked forms only by those rewrites. There is one tenant rule instead of one per output mode and marker style.

### 1. Checks are pure rules

Each check takes one candidate and returns findings. It knows nothing about modes and never throws for a finding.

```ts
type GuardrailCheckId = "read-only" | "tenant" | "sensitive";
type GuardrailForm = "sql" | "template";

type Candidate = {
  forms: Partial<Record<GuardrailForm, string>>; // pre-render (decision 0)
  dialect: DialectSpec | undefined;              // undefined for a custom AskDialect
  schema: AnyNormalizedSchema;                   // v1 or v2
  tenant?: { policy: NormalizedTenantPolicy; scope: TenantScope }; // v2 with a tenant policy only
};

type GuardrailFinding = {
  check: GuardrailCheckId;
  form: GuardrailForm | "generator"; // "generator": reported by a custom AskDialect (decision 3)
  rule: SqlValidationRuleCode | TenantGuardrailRuleCode | SensitiveReferenceRuleCode;
  message: string;
  // plus the check's existing detail: tableId (tenant), reference / unresolvedScope (sensitive)
};

interface GuardrailCheck {
  id: GuardrailCheckId;
  evaluate(candidate: Candidate): GuardrailFinding[];
}
```

Every check evaluates every form in the candidate. Checking `template` as well as `sql` is defense in depth: by the structural-equality rule above, the forms can't produce different findings through `ask()` today, but the invariant costs one extra scan and survives changes to that rule.

`scope` is the scope of the enforcement point that builds the candidate: the expanded scope inside `ask()`, and the bind-time scope at rebind (decision 4). The tenant check reads the scope's kind and the roots it names (`scopeRootIds` in `tenant-guardrail.ts`, since #341: each named root's table must be filtered on its own tenant column); it never reads IDs. IDs are enforced by rendering instead: tenant substitution fills each `:tenant_*` placeholder from the scope's IDs for that placeholder's root, and throws when the scope has none (see "What re-check at rebind settles" for the `global` case). Neither step needs a `subtree` expanded inside the binder, so a check at rebind stays synchronous.

Tenant data exists only on v2 schemas. On a v1 schema the candidate has no `tenant`, and the sensitive and read-only checks run as they do today.

### 1b. One shared analysis (stage (c))

Parse the candidate once, through the existing lexer and `DialectSpec`: statements, table references with aliases and subquery/CTE nesting, predicates grouped by `AND`/`OR`, and placeholders. Every check (read-only, sensitive, tenant, and later #314 and #319) reads that analysis instead of doing its own regex or lexing. This keeps checks single-purpose and open to extension. It's also where a deterministic rewrite (#235, as a transform before the checks) or a real parser (as another implementation of the analysis) plugs in, without touching the pipeline. #310 doesn't depend on it.

### 2. One decision function

`decide` maps findings × configured modes × enforcement point to a verdict. It is the only code that knows `strict` / `warn` / `off`, and the only code that knows what `warn` means at each enforcement point.

```ts
type GuardrailOutcome = "allow" | "warn" | "deny";
type GuardrailPoint = "return" | "rebind";   // ask() / generateSelectSql() return, or bindPreparedQuery()
type GuardrailModes = {
  tenant?: "warn" | "strict";                 // from the tenant policy's `enforcement`; absent without a policy
  sensitive: "off" | "warn" | "strict";       // from the caller; default "warn"
  acceptWarnings?: ReadonlyArray<"tenant">;   // rebind only: checks whose `warn` the caller accepts
};                                            // read-only has no mode
type GuardrailVerdict = { outcome: GuardrailOutcome; findings: GuardrailFinding[] };

function decide(findings: GuardrailFinding[], modes: GuardrailModes, point: GuardrailPoint): GuardrailVerdict;
```

| Check | At return, finding on `sql` | At return, finding on `template` inside `ask()` | At rebind, finding on the template |
|---|---|---|---|
| read-only | `deny`, always; no mode can downgrade it | the form is dropped with every reuse artifact, as today; not a `deny` | `deny`, always |
| tenant | `strict` → `deny`; `warn` → `warn` | same as `sql` | `strict` → `deny`; `warn` → `deny`, or `warn` when `acceptWarnings` includes `"tenant"` |
| sensitive | `strict` → `deny`; `warn` → `warn`; `off` → the check doesn't run | same as `sql` | same as at return: `warn` is reported in the verdict, not refused |

The outcome is the most severe entry. A read-only finding on the optional `template` drops that form rather than failing `ask()`: the bound `sql` passed, the dropped form is never returned, and failing the whole call over a malformed optional block would cost availability with no safety gain. So the read-only check runs on `template` first, inside generation (as today), and a failing `template` never reaches `decide`. Inside `ask()`, the candidate holds the forms that survive generation, as #341 checks them today: a template that the consistency check or rendering (tenant marker alignment) later drops is still checked, and the verdict stands.

**Why only a tenant `warn` is refused at rebind.** `warn` means "return and report" everywhere except where reuse is itself the risk. A tenant `warn` at rebind means a statement that may read other tenants' rows runs again, with nobody looking at a fresh generation; that is the #186 requirement, so it is refused unless the caller accepts it. A sensitive `warn` is the default configuration (`sensitiveGuardrailMode` defaults to `warn`, and sensitive columns are in the prompt by default), and the sensitive check is documented as defense in depth, not a security boundary (`sensitive-guardrail.ts`). Refusing it would break every default-configuration template that reads a sensitive column. Reporting it in the rebind result's verdict on every rebind meets the requirement that a warning isn't seen only once. An operator who wants sensitive reads refused sets `strict`, which denies at both points.

The verdict records no `basis` (policy or schema hashes). Under re-check at rebind nothing reads it, and core has no canonical schema hashing to build it from.

### 3. Every path builds the same candidate; the check set is per path

| Path | read-only | tenant | sensitive | Reuse artifacts |
|---|---|---|---|---|
| `ask()`, built-in id or `DialectSpec` | yes | with a v2 tenant policy | unless `sensitiveGuardrailMode: "off"` | yes, when kept |
| `ask()`, custom `AskDialect` | **no** | with a v2 tenant policy | unless `"off"` | never produced |
| `generateSelectSql()` (public) | yes | when `deps.tenantPolicy` and `deps.tenantScope` are set | **no** | `unboundNamedSql` and manifest only; no `PreparedQuery` |
| `bindPreparedQuery()` | yes | with a v2 tenant policy | unless `"off"` | n/a |

- **Custom `AskDialect`:** the read-only check stays out of scope. The documented contract (`AskDialect` in `ask.ts`, and `reference/core-api.mdx`) makes the escape hatch valid for non-SELECT targets, and `validateSelectSql` needs a `DialectSpec` the path doesn't have. The tenant and sensitive checks run with `dialect: undefined`, reading the SQL every built-in way as they do today.
- **A custom generator's `tenantGuardrail`:** with a tenant policy, its warnings become tenant findings (`form: "generator"`) and go through `decide` with the policy's mode. They can add findings, never remove them. A `passed: false` with no warnings becomes one finding with rule `UNPROVABLE_SCOPE`, so it is never dropped (today it fails the merged result, with a generic message under `strict`). Without a tenant policy there is no mode to decide with, so it passes through to `result.tenantGuardrail` unchanged, as today.
- **`generateSelectSql()`:** it takes no sensitive mode (`GenerateSqlDeps`), so it runs no sensitive check, as today; `GenerateSqlDeps` doesn't change. Its tenant mode comes from `deps.tenantPolicy.enforcement`. It already checks the pre-render forms, so for the same model reply and modes it produces the same read-only and tenant findings as `ask()`.

### 4. Enforcement points act on the verdict; they never re-derive modes

- **`ask()` return:** `deny` → throw; `warn` → return the result with the verdict; `allow` → return.
- **`generateSelectSql()` return:** the same.
- **Reuse:** `bindPreparedQuery()` is an enforcement point (see "Enforcing reuse"): it runs the same checks and `decide` (with `point: "rebind"`) on the template, under the bind-time scope and modes, then `deny` → throw, `warn` / `allow` → bind and return the verdict.

**When several checks deny,** all checks still run (they're pure and cheap), and the thrown error is the existing typed error of the highest-precedence check: read-only (`SqlValidationError`), then tenant (`TenantGuardrailError`), then sensitive (`SensitiveReferenceError`). That is the order today (read-only throws inside generation; tenant runs before sensitive in `ask()`), so callers' `instanceof` handling doesn't change. Tenant ranks above sensitive because a cross-tenant read is the wider leak. The thrown error gains a `verdict` property with every finding.

### 5. Public surface

- **Existing validators stay public with unchanged signatures and behavior.** `validateSelectSql`, `validateSensitiveReferences(sql, schema, { mode })` and `validateTenantGuardrails(sql, policy, scope, options)` remain the rules' public entry points. Internally, the last two become the pure rule plus a single-check call to `decide`, so modes still live in one place. They are not deprecated.
- **New public types:** `result.verdict` (and the verdict on `generateSelectSql()`'s result and on the rebind result) make `GuardrailVerdict`, `GuardrailFinding`, `GuardrailOutcome`, `GuardrailCheckId` and `GuardrailForm` (named by `GuardrailFinding.form`) public, along with the rebind options types: `BindGuardrails` for `bindPreparedQuery()`'s third argument in `@askdb/core`, and the `askdb.bind()` options type in `@askdb/client`. They are exported from `@askdb/core`'s entry point, like every type named in an exported signature. They are in-memory API only: AskDB doesn't persist them, so they carry no format version and change under the normal pre-1.0 rules (breaking = minor changeset). The rule-code unions are already exported from `errors.ts`.
- **New public helper:** `expandTenantScope(policy, scope, resolveTenantDescendants)`, the async `subtree` expansion `ask()` already runs (`expandSubtreeScope` in `ask.ts`, ADR 0014), exported so a host can expand a scope once before the synchronous rebind (see "What re-check at rebind settles"). `ask()` calls the same function, so there is one expansion.
- **Internal:** `Candidate`, `GuardrailCheck`, `decide` and the analysis stay internal to `@askdb/core` (Alternative D).
- **Compatibility fields stay:** `result.tenantGuardrail` and `result.sensitiveGuardrail` are derived from the verdict. Deprecate them only if a later release chooses to.

## Enforcing reuse: re-check at rebind

The #186 requirement is that a template which failed a check can't be replayed by accident. Four mechanisms meet it to different degrees; the maintainer chose re-check at rebind.

- **Stored verdict** (this ADR's first draft): `PreparedQuery` carries the verdict it was produced under, and `bindPreparedQuery()` refuses a non-`allow` template unless the caller opts in.
- **Re-check at rebind:** `bindPreparedQuery()` re-runs every check on the template, with the schema, scope and modes given at bind time, through the same `decide`, and renders the tenant values from the bind-time scope. Nothing is stored on the template.
- **Hybrid:** the verdict is stored on `PreparedQuery` for information, and the re-check at rebind is authoritative.
- **Drop on warn, with an `ask()`-time opt-in** (Alternative A, amended): `ask()` drops the reuse artifacts when a check warns, unless the caller opts in per check (e.g. `keepReuseArtifactsOnWarn: ["tenant"]`). Rebind is unchanged.

| | Stored verdict | Re-check at rebind | Hybrid | Drop on warn + opt-in |
|---|---|---|---|---|
| **Missing or stale verdict** | Must fail closed by rule: a `version: 2` template requires a verdict, and a v1 or field-by-field-persisted template rebinds only with an explicit `acceptUnverified`. Every template stored before the change needs that opt-in or a new `ask()`. A verdict goes stale when the policy or schema changes, and nothing detects it without `basis` hashes. | Nothing stored, so nothing to miss. The checks always use the current schema and policy. A call without the guardrail context fails closed (see below). Old v1 templates are checked like new ones. | As re-check; the stored verdict can be stale, but nothing trusts it. | Fails closed at `ask()` (no template on warn). An opted-in template, or one that passed, then rebinds unchecked forever; stale policy is never re-applied. |
| **Scope (admin `global` template, or a template for root A, rebound under another scope)** | Under `global` the tenant check passes unconditionally and the prompt says tenant filtering is optional, so the admin's template has no `:tenant_*` placeholder and an `allow` verdict. To catch the rebind, the verdict must record the scope kind and roots, and the host must pass the bind-time scope anyway to compare. Otherwise it fails open. | The tenant check runs under the bind-time scope's kind and roots: with #341's rules (each named root's table needs `col = :tenant_…_ids` ANDed in), the admin template fails it under an `ids` scope. Roots and IDs come from rendering: each placeholder is filled from the bind-time scope's IDs for its root, so a root-A template can't bind under a root-B scope. | As re-check. | Not addressed: the admin template has no warning, so it is returned and rebinds unscoped. |
| **Tenant values at rebind** | Host-supplied, unchecked (as today). And the `col = :tenant_…_ids` form, the one the tenant contract and #341 prescribe, can't be rebound on `main` today: `ask()` declares each `:tenant_*` as a list parameter (`scanTenantDecls`), and the binder accepts a list only as the sole element of `IN (…)` or `= ANY(…)` (`isValidListContext`), so it throws `INVALID_LIST_CONTEXT`. This mechanism needs a binder fix as well. | Rendered from the bind-time scope by tenant substitution, the renderer `ask()` uses, which rewrites `=` to `IN (…)` (`planEdit`). So the `=` form rebinds. A host-supplied `:tenant_*` value is rejected. One source of truth, as in `ask()`. | As re-check. | Host-supplied, unchecked, and the `=` form can't be rebound (as for the stored verdict). |
| **What `warn` means at reuse** | Refused unless accepted per check. | A tenant `warn` is refused unless accepted; a sensitive `warn` is reported in the verdict, as at `ask()`. | As re-check. | A warned template is never handed out unless opted in at `ask()`; after that it rebinds unchecked. |
| **Persistence and versioning for hosts** | `PreparedQuery` becomes `version: 2`. `GuardrailVerdict`, `GuardrailFinding` and the rule codes become a persisted, versioned format hosts must store and migrate. Hosts that store columns (`namedSql`, `parameters`) add one. | None. `PreparedQuery` stays `version: 1` with no new field. | As stored verdict (format, versioning), for display value only. | None. |
| **Cost at rebind** | A field comparison, plus the scope comparison above. | The schema (with its tenant policy), the scope and the modes must be available where the host rebinds. For plan 033's intended use (rebind after a form edit, right after `ask()`) the host already holds them. `@askdb/client` users don't: `AskDbClient` exposes only `ask()` and `reload()`, and the schema it resolves is private, so the client needs `askdb.bind()` (below). One scan per check over the template, the same order of work `bindPreparedQuery()` already does (it lexes the template and validates both rendered forms). | As re-check. | None. |
| **Layering** | The binder interprets a decision made at another time, under inputs it can't see. `basis` would add canonical schema hashing to core. | The same checks and the same `decide` run at both enforcement points: one decision point, literally. The checked binder calls the guardrail module and the tenant resolution `ask()` uses, from a module above `bind.ts` (see "Module layering" below); all stay pure and synchronous in `@askdb/core`. `@askdb/client` supplies its cached schema and forwards, so config resolution stays in the facade. | Both mechanisms' code. | Everything stays in `ask()`; rebind unchanged. |

**Decision: re-check at rebind, with no stored verdict.** It avoids three of the stored verdict's problems outright: the fail-open on missing verdicts, the scope mismatch, and a new persisted format. It also removes the staleness problem `basis` existed for, and takes tenant values from the same scope `ask()` uses. With per-check opt-ins on both sides, amended Alternative A differs from it only in the `global` / other-root scope case, policy and schema changes, and where tenant values come from; those three are why the decision needs more than A. Its cost is real: a host must have the schema and scope where it rebinds, and it reverses a design-review decision (next section). A host that rebinds already knows the caller's tenant access, and a scope-safe stored verdict would need the bind-time scope too, so the extra input is the schema; `askdb.bind()` supplies it for `@askdb/client` users. The hybrid adds a persisted format for display only; a host that wants to show "had warnings" can store `result.verdict` itself. Drop-on-warn is the fallback if #310 slips, but it doesn't address the scope case.

### What this reverses

Plan 033, which introduced `bindPreparedQuery()`, was rewritten after a maintainer design review. It says the binder "must **not** take a schema, compute fingerprints, validate a `TenantScope` shape, re-run tenant guardrails, or police reuse" (`plans/033-reusable-parameterized-queries.md`, "Local rebind utility"), and lists "tenant access-shape comparison at bind time" and any `packages/client/src/client.ts` change as out of scope. `plans/README.md` records that the first draft's fingerprints, tenant access-shape comparison and `client.bind()` rebind path were dropped because "every AskDB request always invokes the model" (plan 033: "This is not a cache").

**The premise that changed:** plan 033 treated a rebind as a form edit right after `ask()`, not a reuse path. The shipped binder is public, `PreparedQuery` is documented as serializable input (`bind.ts`), and the docs present it as "Local rebind — no model call" (`guides/multi-tenancy.mdx`). The #186 review showed hosts can store a template and rebind it indefinitely without the model, and the checks the binder skips are the tenant and sensitive checks. So the binder is a reuse path in practice, whatever it was intended as.

**What still holds from plan 033:** `ask()` always calls the model; AskDB adds no cache, cache key, fingerprint, persistence or signing; the HTTP API still doesn't accept caller-supplied prepared SQL. **What is reversed:** the binder takes a schema and a scope, validates the scope, re-runs the guardrails, and renders tenant values from the scope; `@askdb/client` gains `askdb.bind()`.

### What re-check at rebind settles

- **Signature.** `bindPreparedQuery(prepared, values, guardrails)`, where `guardrails` is `{ schema, tenantScope?, sensitiveGuardrailMode?, acceptWarnings? }`. The third argument is required.
- **Fails closed.** Called without it (plain JavaScript), `bindPreparedQuery()` throws `QueryParameterError` with a new reason, `MISSING_GUARDRAIL_CONTEXT`. A schema with a tenant policy and no `tenantScope` throws `TenantScopeError`, as in `ask()` (`validateTenantScope`). A template with a `:tenant_*` placeholder in a code region, bound with a schema that has no tenant policy (v1, or v2 with the policy removed), throws `TenantScopeError` (`UNRESOLVED_TENANT_PLACEHOLDER`): nothing can render the placeholder, and it is never returned raw. There is no public unchecked binder; `ask()`'s internal consistency check uses an internal renderer.
- **Modes come from the same places as in `ask()`.** Tenant: the policy's `enforcement`. Sensitive: `sensitiveGuardrailMode`, default `"warn"`. `decide` maps them with `point: "rebind"`; the binder never interprets a mode.
- **Tenant values come from the bind-time scope, rendered by tenant substitution.** The binder's list binding never touches a `:tenant_*` placeholder. The binder binds the business parameters and skips every `:tenant_*` placeholder by name, from the same lexer scan it already does, so a business value is never rewritten (a textual mask and unmask, as `ask()`'s consistency check uses on `unboundSql`, would also rewrite a string value equal to the mask token once it is inlined as a literal in `sql`). It then renders the tenant placeholders with the code `ask()` uses (`resolveTenantSql` in `tenant-placeholders.ts`: `resolvePlaceholders` looks up the IDs, `planEdit` does the operator rewrite). So `col = :tenant_…_ids` renders as `col IN (…)` (or `col = …` with one ID), exactly as in `ask()`, where the binder's list binding would throw `INVALID_LIST_CONTEXT`.
  - In `sql`, the tenant IDs become escaped literals (`"sql-only"` rendering).
  - In `unboundSql`, they become driver markers after the business markers, with the IDs folded into `params` in marker order: appended for `$N` / `@pN` dialects, interleaved in source order for `?` dialects, with `parameters[].indices` remapped. This is what `ask()`'s `bindTenantIntoUnboundSql` does; #310 moves that function next to the binder so both callers share it. Where `ask()` drops the reuse artifacts because the tenant markers can't be aligned, the binder throws `QueryParameterError` with a new reason, `TENANT_PARAM_ALIGNMENT`.
  - An `ids` scope supplies its root's IDs, and a `multi_root` scope supplies each listed root's IDs. A placeholder whose root has no IDs in the scope throws `TenantScopeError` (`UNRESOLVED_TENANT_PLACEHOLDER`), so a template scoped through one root can't bind under a scope for another.
  - A `subtree` scope must arrive expanded the way `ask()` expands it (ADR 0014): a `multi_root` scope with one entry per covered root, or an `ids` scope when the subtree is the root table alone. A covered root with `ids: []` throws `UNRESOLVED_TENANT_PLACEHOLDER` for its placeholder, as above. An unexpanded `subtree` throws `SUBTREE_NOT_RESOLVABLE`, as `resolveTenantSql()` does. Hosts don't build that expansion by hand: they call core's `expandTenantScope()` (decision 5) with their `resolveTenantDescendants`, which keeps empty levels in the scope as ADR 0014 requires, so a rebind refuses an unfiltered read of an empty level exactly as `ask()` does. `askdb.bind()` does this for facade users.
  - **`global` is a new rule.** On `main`, `resolveTenantSql()` returns the SQL unchanged under a `global` scope, before any placeholder lookup, and `tenant-placeholders.test.ts` pins that. So `ask()` under `global` today returns SQL with raw `:tenant_*` placeholders, `tenantGuardrail.passed: true`, and a `preparedQuery`. The binder does not inherit that pass-through: a template with a `:tenant_*` placeholder rebound under a `global` scope throws `TenantScopeError` (`UNRESOLVED_TENANT_PLACEHOLDER`). A template without one binds. `ask()` adopts the same rule (next section).
  - All of this is synchronous. A `:tenant_*` key in `values` throws `QueryParameterError` with a new reason, `TENANT_VALUE_SUPPLIED`, so there is one source of truth. Authorization stays the host's, exactly as in `ask()`: it happens when the host builds `tenantScope`.
- **Scope.** The tenant check runs under the bind-time `tenantScope`, whatever scope the template was produced under.
- **Opt-in is per check.** `acceptWarnings` accepts `"tenant"`, the only check whose `warn` is refused at rebind. Read-only has no `warn` outcome, and a sensitive `warn` is never refused, so neither can be listed. A later check whose `warn` is refused at rebind joins the list; per-rule-code acceptance can be added without breaking this.
- **Errors.** A refusal throws the check's existing typed error, with the precedence in decision 4 and the verdict attached, so `ask()` and rebind share one error family. A refused tenant `warn` throws `TenantGuardrailError` whose message names `acceptWarnings`.
- **Result.** The rebind result (`BoundQuery`) gains `verdict`, so an accepted tenant warning and any sensitive warning are reported on every rebind, not once.
- **`@askdb/client`.** `AskDbClient` gains `bind(prepared, values, options?)`, with `options` `{ tenantScope?, resolveTenantDescendants?, sensitiveGuardrailMode?, acceptWarnings?, schema? }`. It resolves the schema the way its `ask()` does (per-call `schema` override, then the client default, then `host.schemaJson` or `ASKDB_SCHEMA_JSON`, then `host.schemaPath` or `ASKDB_SCHEMA_PATH`), expands a `subtree` scope with core's `expandTenantScope()` and the forwarded resolver, as `ask()` does, and forwards to core's `bindPreparedQuery()`. Because the expansion can call the host's async resolver, `askdb.bind()` returns a `Promise<BoundQuery>`, like `askdb.ask()`; core's `bindPreparedQuery()` stays synchronous. Hosts on the facade don't re-implement config resolution or the expansion.
- **Module layering.** `sql/bind.ts` stays the primitive, mechanical renderer: `tenant-placeholders.ts` and `parameter-manifest.ts` import it, and it imports neither them nor the guardrail module. The checked, public `bindPreparedQuery()` and the moved `bindTenantIntoUnboundSql` live in a module above `bind.ts`, `tenant-placeholders.ts` and the guardrail module (for example `sql/rebind.ts`), re-exported from `index.ts` under the same name. `ask()`'s internal consistency check keeps calling the mechanical renderer.

### `global` answers with tenant placeholders

`ask()` also rejects a `global`-scope answer that still contains a `:tenant_*` placeholder, so both enforcement points agree.

**Decision: fix it once, in `resolveTenantSql()`.** Under a `global` scope, throw `TenantScopeError` (`UNRESOLVED_TENANT_PLACEHOLDER`) when the SQL still has a `:tenant_*` placeholder in a code region, instead of returning it unchanged. A placeholder in any other casing (`:TENANT_AGENCY_IDS`) is rejected as it is under the other scopes (`rejectCaseVariantTenantPlaceholders`), before the `global` branch, since the lowercase-only placeholder scan wouldn't see it. SQL without one passes through as today. Reasons:

- The SQL `ask()` returns today isn't executable as returned: the placeholder has no value, and nothing in the result supplies one (`tenantBindings` and `tenantParams` are absent under `global`). It also reports `tenantGuardrail.passed: true` and attaches a `preparedQuery` that the new binder rule refuses under `global`.
- Tenant substitution is the owner of rendering, and both enforcement points call it. One change there keeps them in agreement, with no special case in `ask()` or the binder.
- It fails closed, consistent with how substitution treats every other unresolved placeholder.

The cost is availability for admins: a `global` ask whose model wrote a tenant placeholder anyway (the prompt says predicates are optional under `global`, and still shows a placeholder as an example) fails instead of returning SQL the host couldn't run. Telling the model not to use tenant placeholders under `global` would reduce that; it's a possible prompt follow-up, not part of this decision.

The test that pins today's pass-through changes from "no throw" to expecting `TenantScopeError` (`UNRESOLVED_TENANT_PLACEHOLDER`): `packages/core/src/sql/tenant-placeholders.test.ts`, `describe("resolveTenantSql — fails closed on unresolved placeholders")` › `it("global scope is unaffected: SQL returned unchanged, no throw")`. The other `global` tests in the same file (`"passes through SQL unchanged for global scope"`, `"passes through for global scope with empty params"`, and the `ask()`-level `"passes through unmodified for global scope"`) use SQL without placeholders and don't change. `resolveTenantSql()` is public, so this is a minor `@askdb/core` changeset.

## Alternatives considered

### A. Drop the reuse artifacts whenever a check warns

Simple, needs no type change, and fails closed. Rejected as the long-term design, but not because of how it treats `warn`: with a per-check `ask()`-time opt-in (the amended form in "Enforcing reuse"), it treats a tenant `warn` the way re-check at rebind does (refused by default, accepted per check), and it can leave sensitive warnings alone just as re-check at rebind does. It loses because it enforces only at `ask()`: it doesn't catch the `global` / other-root scope case or policy changes, and a template it hands out rebinds unchecked with host-supplied tenant values. It remains the stop-gap if #310 slips.

### B. Attach the verdict to the template without enforcing it

Additive and respects `warn`, but `bindPreparedQuery()` would ignore it, so an unscoped template could still be replayed indefinitely. The risk would remain, just documented. Rejected.

### C. Keep per-check wiring, add the reuse rule to each check

The smallest diff today, but it is the structure that produced F2, F5, the scope bug and #315, and it grows with every check and mode. Rejected.

### D. A public plugin API for third-party checks

Three checks don't justify a public extension point. The decision point stays an internal module in `@askdb/core`. Revisit if a real third-party check appears.

### E. Store the verdict on the template, enforced at rebind (or a hybrid)

The stored verdict was this ADR's first draft; the hybrid stores it for display and re-checks anyway. Rejected for the reasons in the comparison table: a missing or stale verdict has to fail closed by rule, a scope-safe verdict needs the bind-time scope anyway, and `GuardrailVerdict` would become a persisted, versioned format hosts must migrate. Done safely, it would have needed:

- `PreparedQuery` at `version: 2` with a required verdict; a v1 template, or one with no verdict, rebinding only with `{ acceptUnverified: true }`.
- The verdict recording the scope kind and roots, and `bindPreparedQuery()` refusing a mismatch (including any `global` template rebound under a non-`global` scope) unless the host opts in.
- Tenant values still rendered from the bind-time scope, so the `col = :tenant_…_ids` form rebinds.
- `basis` hashes, with a named consumer and stated coverage, to detect staleness.

Revisit it only if hosts need to rebind where the schema isn't available (see "When to revisit").

## Consequences

- **One place for modes.** Adding a check (or a mode) means writing a pure `evaluate` and a decision-table row, not threading logic through `ask.ts`, `generate.ts` and each result field.
- **Every form is checked on every path in the table above.** No new sensitive findings are expected from checking the template (see Context); the invariant is defense in depth.
- **`bindPreparedQuery()` stops being a mechanical binder.** It takes a schema and a scope, validates the scope, re-runs the guardrails, and renders tenant values from the scope. That reverses plan 033's design-review decision; see "What this reverses".
- **Breaking changes to `bindPreparedQuery()`,** each in a minor `@askdb/core` changeset (pre-1.0) with an upgrade note:
  - the third argument is required;
  - tenant values come from `tenantScope`, and a `:tenant_*` key in `values` throws;
  - a template with a `:tenant_*` placeholder can't be rebound under a `global` scope;
  - a template whose tenant check warns is refused unless `acceptWarnings: ["tenant"]`; this affects hosts whose tenant policy has `enforcement: warn`.
- **`ask()` under a `global` scope** throws `TenantScopeError` (`UNRESOLVED_TENANT_PLACEHOLDER`) when the model's SQL still has a `:tenant_*` placeholder, through the same `resolveTenantSql()` change; placeholder-free admin SQL is unaffected. It is in the same minor `@askdb/core` changeset, with its own upgrade note.
- **The default configuration** (`sensitiveGuardrailMode: "warn"`, sensitive columns in the prompt, no tenant policy) sees only the required argument and a `verdict` on the rebind result. A template that reads a sensitive column still binds; its sensitive warning is reported in the verdict on every rebind. Hosts with a tenant policy also move tenant IDs from `values` to `tenantScope`; with `enforcement: strict` they are refused at rebind exactly when `ask()` would deny the same SQL under that scope, and with `enforcement: warn` a tenant warning is refused unless accepted.
- **`@askdb/client` gains `askdb.bind()`**, additive and async (it can call the host's `resolveTenantDescendants`), with a minor `@askdb/client` changeset. Its docs examples switch from core's `bindPreparedQuery()` to it.
- **`@askdb/core` exports `expandTenantScope()`**, additive: the `subtree` expansion stays in core (ADR 0014) at rebind as well, so no host hand-builds it.
- **Policy and schema changes apply to stored templates** at their next rebind. A template that rebinds today can start failing after the policy is tightened. That is intended: it fails closed.
- **`PreparedQuery` doesn't change.** Templates stored before the change keep working once the host passes the guardrail context.
- **Not a stronger guarantee.** The checks stay heuristic: after #341 the tenant check matches predicate shapes, not a parse, and known gaps remain (#399); #235 or a parser is stage (d). ADR 0012 is the source of this stance: a read-only database role plus database-level tenant enforcement (RLS) remain the real controls, and tightening the lint doesn't move the boundary (its Decision 5 lists this ADR as one such tightening). Docs must not present the new structure as more than tidier, consistent enforcement.
- **No verdict to tamper with.** The host is trusted to build the right `tenantScope`, as in `ask()`.

## When to revisit

- A check needs inputs that don't fit the candidate (e.g. live database metadata).
- Hosts need to rebind where the schema isn't available and `askdb.bind()` doesn't help: reconsider the stored verdict or the hybrid (Alternative E).
- A third-party check becomes a real requirement (then consider Alternative D).
- Deterministic tenant predicate rewriting (#235) lands. The tenant check may then become a rewrite plus a verification step, which could change how the decision table treats it.

## Related

- #310 (implementation), #315 and PR #341 (stage (a): tenant check on the pre-render forms), #399 (tenant check gap after #341), #371 (literal escaping when string settings differ), #235 (deterministic tenant rewriting), #314 and #319 (future read-only rules on the shared analysis), #321 (consumer lab, hostile-ID escaping test).
- PR #186 (tenant enforcement fails closed; the review discussion that led here), #197 (tenant binding), #192 (sensitivity overrides), #190 (dialect-aware lexer), #270 (subtree scope), #375 (subtree scope expands per root).
- `plans/033-reusable-parameterized-queries.md` and its entry in `plans/README.md` (the design review this ADR reverses).
- ADR 0012 (SQL checks are defense in depth; the database is the boundary), ADR 0014 (subtree scope expands per root), ADR 0009 (Studio local API protection), ADR 0006 (AI providers).
- `docs/contracts/tenant-policy.md`, `docs/contracts/sensitive-fields-and-modes.md`, `docs/specs/core-pipeline.md`, `apps/docs-site/src/content/docs/reference/core-api.mdx` (`bindPreparedQuery`, `AskDialect`), `apps/docs-site/src/content/docs/reference/client-api.mdx`.
