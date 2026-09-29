# ADR 0010 — One decision point for SQL guardrails, enforced where SQL is returned and where it is reused

## Status

Proposed (2026-09-27; revised 2026-09-29 after an independent review). The maintainer chose the direction: checks are pure rules, one decision point owns the modes, and enforcement points act on its verdict. One mechanism is still open: **how reuse is enforced** (see "Open question: enforcing reuse"). This ADR recommends re-checking at rebind; the maintainer decides before it is marked Accepted.

Implementation is tracked in #310. It lands after #315 (stage (a) of the plan below). PRs #186, #197 and #192, which this ADR originally waited for, have merged.

## Context

`ask()` runs three checks on model-generated SQL. Each is wired separately, with its own mode vocabulary and its own result shape (as of `main` at `58fc8cde`):

| Check | Where the mode comes from | Modes | How a failure surfaces | Where it is wired |
|---|---|---|---|---|
| Read-only validator (`validateSelectSql`) | nowhere (always on) | none | on the bound SQL, throws `SqlValidationError`; on the model's `sql-unbound` block, drops the reuse artifacts instead (`generate.ts`, `tryParseParameterizedExtras`) | the built-in / `DialectSpec` generate path, on the model's reply before tenant substitution; `bindPreparedQuery()` again on both rebound forms (`bind.ts`); custom `AskDialect`s must call it themselves (they may target non-SELECT SQL) |
| Sensitive columns (`validateSensitiveReferences`) | `ask()` option `sensitiveGuardrailMode`, default `warn` | `off` / `warn` / `strict` | `result.sensitiveGuardrail`, or throws `SensitiveReferenceError` | `applySensitiveGuardrail()` in `ask.ts`, on `result.sql` only, after tenant substitution; not in `generateSelectSql()`; not at rebind (hosts are told to call it on replay paths) |
| Tenant (`validateTenantGuardrails`) | tenant policy front matter `enforcement` | `warn` / `strict` | `result.tenantGuardrail`, or throws `TenantGuardrailError` | `enforceTenantGuardrails()` in `ask.ts`, on `sql` and `unboundSql` **after** tenant substitution; in the public `generateSelectSql()`, on the model's forms **before** substitution; not at rebind |

The **reuse artifacts** (`preparedQuery`, `unboundSql`, `params`, `parameters`) exist so a host can re-run the same question with different values without calling the model again: `bindPreparedQuery(result.preparedQuery, values)` is a local rebind, and tenant IDs are `:tenant_*` placeholders the host supplies on every rebind. `ask()` produces them only on the built-in / `DialectSpec` path (a custom `AskDialect` never gets them). It drops them, keeping `sql`, when:

- the model's `sql-unbound` block is missing, fails `validateSelectSql`, or its parameter manifest is invalid (`generate.ts`);
- the template, bound with the manifest values, is not `sqlStructurallyEqual` to the model's `sql`, or that consistency bind throws (`ask.ts`);
- in `sql-params` mode, the tenant markers can't be aligned with the business params (`ask.ts`, `bindTenantIntoUnboundSql`).

This per-path wiring has produced bugs of the same shape:

- **F2 (fixed in #186):** the tenant check ran on different SQL than `ask()` returned, so unscoped SQL came back with `tenantGuardrail.passed: true`.
- **F5 (fixed in #186):** custom dialects skipped the tenant check entirely.
- During the merge of `main`'s subtree support (#270) into #186, the guardrail was still reading `options.tenantScope` instead of the expanded scope the SQL was bound with.
- **#315:** because the tenant check runs on the rendered forms, the placeholder has already become `'2'`, `$1`, `?` or `@p0`. The check can't tell AskDB's own `agency_id = '2'` from a model-written `agency_id = 2`, and each rule would have to be written per output mode × dialect × form. That is why it fell back to a name-presence test, and why strict mode returns SQL whose filter doesn't filter.

The sensitive check reading only `result.sql` looks like the same shape, but it is not a live gap. `unboundSql` and `preparedQuery` are kept only when the template, bound with the manifest values, is `sqlStructurallyEqual` to the model's `sql`, and that comparison normalizes only whitespace, letter case and a trailing `;` (`bind.ts`). Both forms must also pass `validateSelectSql`, which rejects comments. So the template names the same identifiers as `sql`, and the sensitive check matches identifiers case-insensitively. No input reaches a sensitive finding that exists only in the template (short of a schema whose identifiers differ only by whitespace inside quotes).

The review of #186 raised the requirement that triggered this ADR. In `warn` mode, a query that fails a check is returned with the warning, but its `preparedQuery` can be cached and rebound indefinitely with no model call. On every rebind `bindPreparedQuery()` re-runs only the read-only validator; the tenant and sensitive checks don't run. So a tenant or sensitive warning is seen once and the template is reused forever. Fixing that per check, in today's structure, would repeat the logic for the tenant and sensitive checks, and again for every future check or mode.

## Decision

Separate *checking* from *deciding* from *enforcing* (the policy-decision-point / policy-enforcement-point split used in access control). The work is staged:

- **(a) #315:** move the tenant check to the pre-render forms and tighten its rules (decision 0).
- **(b) #310:** this ADR's decision point and enforcement points (decisions 1–5).
- **(c)** Extract the shared analysis (decision 1b), and move the read-only and sensitive checks onto it.
- **(d) Later:** a deterministic predicate rewrite (#235) or a real parser, behind the analysis interface.

### 0. Checks evaluate the untrusted forms, before rendering

The untrusted input is the model's reply. Checks run on it before AskDB renders it:

- `sql`: the model's bound SQL, with the named `:tenant_…_ids` placeholders still in place.
- `template`: the model's `sql-unbound` block, when kept. It is exactly the string `ask()` returns as `preparedQuery.namedSql`, so at rebind the template is the candidate.

Rendering is AskDB's own deterministic code and runs after `decide`: tenant substitution (`resolveTenantSql`, per `tenantSqlMode` and dialect) and binding (`bindPreparedQuery`'s literals and driver markers). It gets its own contract: it replaces placeholder spans with an escaped literal, a literal list, or a driver marker (including the `IN (…)` / `= ANY(…)` list forms), and never changes the statement's structure. That contract is tested on its own, and by the consumer lab's hostile-ID escaping test (#321). `bindPreparedQuery()` keeps running `validateSelectSql` on its rendered output as an assertion of that contract, not as the check.

With this, F2 is removed by construction: the returned forms differ from the checked forms only by rendering. There is one tenant rule instead of one per output mode and marker style.

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

`scope` is the scope of the enforcement point that builds the candidate: the expanded scope inside `ask()`, and the bind-time scope at rebind (decision 4). The tenant check reads `scope.access.kind` only (`tenant-guardrail.ts`); it never reads IDs. So a `subtree` scope needs no expansion to be checked, and a check at rebind stays synchronous.

Tenant data exists only on v2 schemas. On a v1 schema the candidate has no `tenant`, and the sensitive and read-only checks run as they do today.

### 1b. One shared analysis (stage (c))

Parse the candidate once, through the existing lexer and `DialectSpec`: statements, table references with aliases and subquery/CTE nesting, predicates grouped by `AND`/`OR`, and placeholders. Every check (read-only, sensitive, tenant, and later #314 and #319) reads that analysis instead of doing its own regex or lexing. This keeps checks single-purpose and open to extension. It's also where a deterministic rewrite (#235, as a transform before the checks) or a real parser (as another implementation of the analysis) plugs in, without touching the pipeline. #310 doesn't depend on it.

### 2. One decision function

`decide` maps findings × configured modes to a verdict. It is the only code that knows `strict` / `warn` / `off`.

```ts
type GuardrailOutcome = "allow" | "warn" | "deny";
type GuardrailModes = {
  tenant?: "warn" | "strict";              // from the tenant policy's `enforcement`; absent without a policy
  sensitive: "off" | "warn" | "strict";    // from the caller; default "warn"
};                                         // read-only has no mode
type GuardrailVerdict = { outcome: GuardrailOutcome; findings: GuardrailFinding[] };

function decide(findings: GuardrailFinding[], modes: GuardrailModes): GuardrailVerdict;
```

| Check | Finding on `sql` (and on `template` at rebind) | Finding on `template` inside `ask()` |
|---|---|---|
| read-only | `deny`, always; no mode can downgrade it | the form is dropped with every reuse artifact, as today; not a `deny` |
| tenant | `strict` → `deny`; `warn` → `warn` | same as `sql` |
| sensitive | `strict` → `deny`; `warn` → `warn`; `off` → the check doesn't run | same as `sql` |

The outcome is the most severe entry. A read-only finding on the optional `template` drops that form rather than failing `ask()`: the bound `sql` passed, the dropped form is never returned, and failing the whole call over a malformed optional block would cost availability with no safety gain. So the read-only check runs on `template` first, inside generation (as today), and a failing `template` never reaches `decide`. Inside `ask()`, the candidate holds the forms that survive generation and the consistency check. If rendering later drops the reuse artifacts (tenant marker alignment), the verdict stands, because `sql` produces every finding the dropped template could.

The verdict records no `basis` (policy or schema hashes). Under the recommended mechanism nothing reads it, and core has no canonical schema hashing to build it from.

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
- **Reuse:** see the open question below. The recommended mechanism makes `bindPreparedQuery()` an enforcement point that runs the same checks and `decide` on the template, under the bind-time scope and modes.

**When several checks deny,** all checks still run (they're pure and cheap), and the thrown error is the existing typed error of the highest-precedence check: read-only (`SqlValidationError`), then tenant (`TenantGuardrailError`), then sensitive (`SensitiveReferenceError`). That is the order today (read-only throws inside generation; tenant runs before sensitive in `ask()`), so callers' `instanceof` handling doesn't change. Tenant ranks above sensitive because a cross-tenant read is the wider leak. The thrown error gains a `verdict` property with every finding.

### 5. Public surface

- **Existing validators stay public with unchanged signatures and behavior.** `validateSelectSql`, `validateSensitiveReferences(sql, schema, { mode })` and `validateTenantGuardrails(sql, policy, scope, options)` remain the rules' public entry points. Internally, the last two become the pure rule plus a single-check call to `decide`, so modes still live in one place. They are not deprecated.
- **New public types:** `result.verdict` (and the verdict on `generateSelectSql()`'s result and on the rebind result) make `GuardrailVerdict`, `GuardrailFinding`, `GuardrailOutcome` and `GuardrailCheckId` public. They are exported from `@askdb/core`'s entry point, like every type named in an exported signature. Under the recommended mechanism they are in-memory API only: AskDB doesn't persist them, so they carry no format version and change under the normal pre-1.0 rules (breaking = minor changeset). The rule-code unions are already exported from `errors.ts`.
- **Internal:** `Candidate`, `GuardrailCheck`, `decide` and the analysis stay internal to `@askdb/core` (Alternative D).
- **Compatibility fields stay:** `result.tenantGuardrail` and `result.sensitiveGuardrail` are derived from the verdict. Deprecate them only if a later release chooses to.

## Open question: enforcing reuse

This is the open question for the maintainer. The #186 requirement is that a template which failed a check can't be replayed by accident. Four mechanisms meet it to different degrees.

- **Stored verdict** (this ADR's first draft): `PreparedQuery` carries the verdict it was produced under, and `bindPreparedQuery()` refuses a non-`allow` template unless the caller opts in.
- **Re-check at rebind:** `bindPreparedQuery()` re-runs every check on the template, with the schema, scope and modes given at bind time, through the same `decide`. Nothing is stored on the template.
- **Hybrid:** the verdict is stored on `PreparedQuery` for information, and the re-check at rebind is authoritative.
- **Drop on warn, with an `ask()`-time opt-in** (Alternative A, amended): `ask()` drops the reuse artifacts when a check warns, unless the caller opts in per check (e.g. `keepReuseArtifactsOnWarn: ["sensitive"]`). Rebind is unchanged.

| | Stored verdict | Re-check at rebind | Hybrid | Drop on warn + opt-in |
|---|---|---|---|---|
| **Missing or stale verdict** | Must fail closed by rule: a `version: 2` template requires a verdict, and a v1 or field-by-field-persisted template rebinds only with an explicit `acceptUnverified`. Every template stored before the change needs that opt-in or a new `ask()`. A verdict goes stale when the policy or schema changes, and nothing detects it without `basis` hashes. | Nothing stored, so nothing to miss. The checks always use the current schema and policy. A call without the guardrail context fails closed (see below). Old v1 templates are checked like new ones. | As re-check; the stored verdict can be stale, but nothing trusts it. | Fails closed at `ask()` (no template on warn). An opted-in template, or one that passed, then rebinds unchecked forever; stale policy is never re-applied. |
| **Scope (admin `global` template rebound under a tenant scope)** | Under `global` the tenant check passes unconditionally and the prompt says tenant filtering is optional, so the admin's template has no `:tenant_*` placeholder and an `allow` verdict. To catch the rebind, the verdict must record the scope kind (and roots), and the host must pass the bind-time scope anyway to compare. Otherwise it fails open. | Evaluated under the bind-time scope by construction. With #315's rules (a scoped table needs `col = :tenant_…_ids`), the admin template fails the tenant check under an `ids` scope: `strict` denies, `warn` is refused unless accepted. | As re-check. | Not addressed: the admin template has no warning, so it is returned and rebinds unscoped. |
| **Persistence and versioning for hosts** | `PreparedQuery` becomes `version: 2`. `GuardrailVerdict`, `GuardrailFinding` and the rule codes become a persisted, versioned format hosts must store and migrate. Hosts that store columns (`namedSql`, `parameters`) add one. | None. `PreparedQuery` stays `version: 1` with no new field. | As stored verdict (format, versioning), for display value only. | None. |
| **Cost at rebind** | A field comparison, plus the scope comparison above. | The schema (with its tenant policy), the scope and the modes must be available where the host rebinds. One scan per check over the template, the same order of work `bindPreparedQuery()` already does (it lexes the template and validates both rendered forms). | As re-check. | None. |
| **Layering** | The binder interprets a decision made at another time, under inputs it can't see. `basis` would add canonical schema hashing to core. | The same checks and the same `decide` run at both enforcement points: one decision point, literally. `bind.ts` calls the guardrail module; both stay pure and synchronous in `@askdb/core`. | Both mechanisms' code. | Everything stays in `ask()`; rebind unchanged. |

**Recommendation: re-check at rebind, with no stored verdict.** It avoids three of the stored verdict's problems outright: the fail-open on missing verdicts, the scope mismatch, and a new persisted format. It also removes the staleness problem `basis` existed for. Its cost is real: a host must have the schema and scope where it rebinds. A host that rebinds already knows the caller's tenant access (it supplies the tenant IDs), and a scope-safe stored verdict would need the bind-time scope too, so the extra input is the schema. The hybrid adds a persisted format for display only; a host that wants to show "had warnings" can store `result.verdict` itself. Drop-on-warn is the fallback if #310 slips, but it doesn't address the scope case.

### What the recommended mechanism settles

- **Signature.** `bindPreparedQuery(prepared, values, guardrails)`, where `guardrails` is `{ schema, tenantScope?, sensitiveGuardrailMode?, acceptWarnings? }`. The third argument is required.
- **Fails closed.** Called without it (plain JavaScript), `bindPreparedQuery()` throws `QueryParameterError` with a new reason, `MISSING_GUARDRAIL_CONTEXT`. A schema with a tenant policy and no `tenantScope` throws `TenantScopeError`, as in `ask()` (`validateTenantScope`). There is no public unchecked binder; `ask()`'s internal consistency check uses an internal renderer.
- **Modes come from the same places as in `ask()`.** Tenant: the policy's `enforcement`. Sensitive: `sensitiveGuardrailMode`, default `"warn"`. `decide` maps them; the binder never interprets a mode.
- **Scope.** The tenant check runs under the bind-time `tenantScope`, whatever scope the template was produced under.
- **Opt-in is per check.** `deny` → throw. `warn` → throw unless every check with a finding is listed in `acceptWarnings` (e.g. `["sensitive"]`). `allow` → bind. `acceptWarnings` accepts `"tenant"` and `"sensitive"` only: read-only has no warn outcome and can't be accepted. Accepting `"sensitive"` never accepts a tenant warning. Per-rule-code acceptance can be added later without breaking this.
- **Errors.** A refusal throws the check's existing typed error, with the precedence in decision 4 and the verdict attached, so `ask()` and rebind share one error family. The message names `acceptWarnings`.
- **Result.** The rebind result (`BoundQuery`) gains `verdict`, so an accepted warning is reported on every rebind, not once.
- **Tenant values.** The host still supplies the `:tenant_*` values and still authorizes them. Deriving them from the bind-time scope is a possible follow-up, not part of #310.

### If the maintainer chooses the stored verdict instead

The review showed these must be settled in this ADR before #310, not during implementation:

- `PreparedQuery` goes to `version: 2` with a required verdict. A v1 template, or one with no verdict, rebinds only with `{ acceptUnverified: true }`: a missing verdict fails closed.
- The verdict records the scope kind (and roots) it was computed under. `bindPreparedQuery()` takes the bind-time scope and refuses a mismatch, including any `global` template rebound under a non-`global` scope, unless the host opts in explicitly.
- Opt-in is per check, as above.
- The verdict types become a persisted format: exported, and versioned with `PreparedQuery`.
- `basis` is added only with a named consumer and a stated hash coverage; otherwise it stays out.

## Alternatives considered

### A. Drop the reuse artifacts whenever a check warns

Simple, needs no type change, and fails closed. Rejected as the long-term design. Correctly scoped queries that trip a heuristic check (the tenant check is a presence test until #315) lose reuse and cost another model call, and it partly overrides the operator's choice of `warn`. The amended form with a per-check `ask()`-time opt-in answers both objections, but it still doesn't catch the `global`-template case or policy changes (see the open question). It remains the stop-gap if #310 slips.

### B. Attach the verdict to the template without enforcing it

Additive and respects `warn`, but `bindPreparedQuery()` would ignore it, so an unscoped template could still be replayed indefinitely. The risk would remain, just documented. Rejected.

### C. Keep per-check wiring, add the reuse rule to each check

The smallest diff today, but it is the structure that produced F2, F5, the scope bug and #315, and it grows with every check and mode. Rejected.

### D. A public plugin API for third-party checks

Three checks don't justify a public extension point. The decision point stays an internal module in `@askdb/core`. Revisit if a real third-party check appears.

## Consequences

- **One place for modes.** Adding a check (or a mode) means writing a pure `evaluate` and a decision-table row, not threading logic through `ask.ts`, `generate.ts` and each result field.
- **Every form is checked on every path in the table above.** No new sensitive findings are expected from checking the template (see Context); the invariant is defense in depth.
- **`bindPreparedQuery()` gains a required argument and can refuse a template** (under the recommendation). This is a breaking change: a minor `@askdb/core` changeset (pre-1.0) with an upgrade note. It affects the **default configuration**, not only hosts that chose `warn`: `sensitiveGuardrailMode` defaults to `warn` and sensitive columns are in the prompt by default, so a template that reads a sensitive column is refused at rebind until the host passes `acceptWarnings: ["sensitive"]` or `sensitiveGuardrailMode: "off"`.
- **Policy and schema changes apply to stored templates** at their next rebind. A template that rebinds today can start failing after the policy is tightened. That is intended: it fails closed.
- **`PreparedQuery` doesn't change** (under the recommendation). Templates stored before the change keep working once the host passes the guardrail context.
- **Not a stronger guarantee.** The checks stay heuristic: after #315 the tenant check matches predicate shapes, not a parse; #235 or a parser is stage (d). A read-only database role plus database-level tenant enforcement (RLS) remain the real controls. Docs must not present the new structure as more than tidier, consistent enforcement.
- **No verdict to tamper with** (under the recommendation). The host is trusted to pass the right scope and to authorize tenant IDs, as today.

## When to revisit

- A check needs inputs that don't fit the candidate (e.g. live database metadata).
- Hosts need to rebind where the schema isn't available: reconsider the stored verdict or the hybrid.
- A third-party check becomes a real requirement (then consider Alternative D).
- Deterministic tenant predicate rewriting (#235) lands. The tenant check may then become a rewrite plus a verification step, which could change how the decision table treats it.

## Related

- #310 (implementation), #315 (stage (a): tenant check on the pre-render forms), #235 (deterministic tenant rewriting), #314 and #319 (future read-only rules on the shared analysis), #321 (consumer lab, hostile-ID escaping test).
- PR #186 (tenant enforcement fails closed; the review discussion that led here), #197 (tenant binding), #192 (sensitivity overrides), #190 (dialect-aware lexer), #270 (subtree scope).
- ADR 0009 (Studio local API protection), ADR 0006 (AI providers).
- `docs/contracts/tenant-policy.md`, `docs/contracts/sensitive-fields-and-modes.md`, `apps/docs-site/src/content/docs/reference/core-api.mdx` (`bindPreparedQuery`, `AskDialect`).
