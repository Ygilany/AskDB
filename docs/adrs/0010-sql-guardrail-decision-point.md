# ADR 0010 — One decision point for SQL guardrails, enforced where SQL is returned and where it is reused

## Status

Proposed (2026-09-27). To be implemented after PRs #186, #197 and #192 merge (they all edit `packages/core/src/ask.ts` and `packages/core/src/sql/generate.ts`). Tracked by the issue linked from this ADR's PR.

## Context

`ask()` runs three checks on model-generated SQL. Each is wired separately, with its own mode vocabulary and its own result shape:

| Check | Where the mode comes from | Modes | How a failure surfaces | Where it is wired |
|---|---|---|---|---|
| Read-only validator (`validateSelectSql`) | nowhere (always on) | none | throws `SqlValidationError` | inside the built-in dialects' `generate` path, for the bound and unbound SQL; custom `AskDialect`s must call it themselves |
| Sensitive columns (`validateSensitiveReferences`) | `ask()` option `sensitiveGuardrailMode` | `off` / `warn` / `strict` | `result.sensitiveGuardrail`, or throws `SensitiveReferenceError` | `applySensitiveGuardrail()` in `ask.ts`, on `result.sql` only |
| Tenant (`validateTenantGuardrails`) | tenant policy front matter `enforcement` | `warn` / `strict` | `result.tenantGuardrail`, or throws `TenantGuardrailError` | `enforceTenantGuardrails()` in `ask.ts` (on `sql` and `unboundSql`), and again in the public `generateSelectSql()` |

Separately, `ask()` has ad-hoc rules about the **reuse artifacts** (`preparedQuery`, `unboundSql`, `params`, `parameters`): they are dropped when the model's bound and unbound SQL disagree.

The reuse artifacts exist so a host can re-run the same question with different values **without calling the model again**: `bindPreparedQuery(result.preparedQuery, values)` is a local rebind, and tenant IDs are `:tenant_*` placeholders the host supplies on every rebind.

This per-path wiring has already produced bugs of the same shape:

- **F2 (fixed in #186):** the tenant check ran on different SQL than `ask()` returned, so unscoped SQL came back with `tenantGuardrail.passed: true`.
- **F5 (fixed in #186):** custom dialects skipped the tenant check entirely.
- During the merge of `main`'s subtree support (#270) into #186, the guardrail was still reading `options.tenantScope` instead of the expanded scope the SQL was bound with.
- The sensitive check reads only `result.sql`, never `unboundSql` or the reuse template.

The review of #186 then raised a new requirement (see "Reuse artifacts" below). In `warn` mode, a query that fails a check is returned with the warning, but its `preparedQuery` can be cached and replayed indefinitely with no model call and no check, so the warning is seen once and the query is reused forever. Implementing the fix per check, in today's structure, would repeat that logic for tenant and sensitive checks, and again for every future check or mode.

## Decision

Separate *checking* from *deciding* from *enforcing* (the policy-decision-point / policy-enforcement-point split used in access control):

1. **Checks are pure rules.** Each check takes one candidate and returns findings; it knows nothing about modes and never throws for a finding.

   ```ts
   type Candidate = {
     sql: string;              // the SQL returned to the caller (after tenant substitution)
     unboundSql?: string;      // driver-marker form, when kept
     template?: string;        // PreparedQuery.namedSql — the form a host reuses
     dialect: DialectSpec | undefined;
     schema: NormalizedSchemaV2;
     tenant?: { policy: NormalizedTenantPolicy; scope: TenantScope }; // scope = the expanded scope used for binding
   };
   interface GuardrailCheck {
     id: "read-only" | "sensitive" | "tenant";
     evaluate(candidate: Candidate): GuardrailFinding[];
   }
   ```

   Every check evaluates **every** SQL form in the candidate. That removes the F2 class of bug (checking a different form than the one returned) by construction.

2. **One decision function** maps findings × configured modes to an outcome. It is the only code that knows about `strict` / `warn` / `off`.

   ```ts
   type GuardrailOutcome = "allow" | "warn" | "deny";
   type GuardrailVerdict = {
     outcome: GuardrailOutcome;
     findings: GuardrailFinding[];                 // per check, with rule codes
     basis: { policyHash?: string; schemaHash: string; checks: string[] }; // what the verdict was computed against
   };
   function decide(findings: Map<CheckId, GuardrailFinding[]>, modes: GuardrailModes): GuardrailVerdict;
   ```

   Some rules have **no downgrade path**: a read-only-validator finding is always `deny`, whatever modes are configured. The decision table encodes that; it does not become a `warn` option just because the other checks have one.

3. **Enforcement points** consult the verdict. They never re-derive modes.
   - **`ask()` return:** `deny` → throw (the existing typed errors: `SqlValidationError`, `SensitiveReferenceError`, `TenantGuardrailError`, so callers' `instanceof` checks keep working); `warn` → return the result with the verdict; `allow` → return.
   - **The reuse artifact:** `PreparedQuery` carries the verdict it was produced under (`preparedQuery.verdict`).
   - **`bindPreparedQuery()`:** refuses a template whose verdict is not `allow` unless the caller opts in explicitly (e.g. `bindPreparedQuery(prepared, values, { acceptWarnings: true })`). A template stays reusable after a false positive, but can't be replayed by accident.
   - **All dialect paths** (built-in, `DialectSpec`, custom `AskDialect`, and the public `generateSelectSql()`) build the same candidate and go through the same `decide`. That removes the F5 class of bug.

4. **Existing result fields stay.** `result.tenantGuardrail` and `result.sensitiveGuardrail` are derived from the verdict for compatibility; `result.verdict` (or a similarly named field) is the new single source of truth. Deprecate the per-check fields only if a later release chooses to.

### Reuse artifacts (the requirement that triggered this ADR)

- A `preparedQuery` returned by `ask()` passed exactly the checks `sql` passed, under the same modes. Its verdict travels with it.
- In `warn` mode the template is still returned, marked `warn`. `bindPreparedQuery()` refuses it unless the host passes `acceptWarnings`.
- Rebinding swaps in escaped values only, so it can't change the statement's shape. The verdict therefore stays valid for new *business* values. Authorizing new *tenant* IDs remains the host's job (documented today).
- `basis` records the tenant-policy and schema hashes, so a host (or a future `bindPreparedQuery` option) can detect that the policy changed after the template was produced.

## Alternatives considered

### A. Drop the reuse artifacts whenever a check fails in `warn` mode

Simple, needs no type change, and fails closed. Rejected as the long-term design: correctly scoped queries that trip a heuristic check (the tenant check is a presence test) lose reuse and cost another model call, and it partly overrides the operator's choice of `warn`. It would still have to be written once per check in today's structure. It remains a reasonable stop-gap if this ADR slips.

### B. Attach the verdict to the template without enforcing it

Additive and respects `warn`, but `bindPreparedQuery()` would ignore it, so an unscoped template could still be replayed indefinitely. The risk would remain, just documented. Rejected.

### C. Keep per-check wiring, add the reuse rule to each check

The smallest diff today, but it is the structure that produced F2, F5 and the scope bug above, and it grows with every check and mode. Rejected.

### D. A public plugin API for third-party checks

Three checks don't justify a public extension point. The decision point stays an internal module in `@askdb/core`. Revisit if a real third-party check appears.

## Consequences

- **One place for modes.** Adding a check (or a mode) means writing a pure `evaluate` and a decision-table row, not threading logic through `ask.ts`, `generate.ts` and each result field.
- **Every SQL form is checked, on every dialect path**, including the sensitive check on `unboundSql` and the template, which it skips today. Expect a few new `warn` findings for queries whose unbound form reads a sensitive column.
- **`PreparedQuery` gains an optional field.** It is a versioned, host-persisted type. Templates stored before the change carry no verdict and rebind as today. Decide during implementation whether that is `version: 1` with an optional field or `version: 2`.
- **`bindPreparedQuery()` can now throw on a `warn` template.** That is a behavior change for hosts that rebind templates from `warn`-mode results; it gets a minor changeset (pre-1.0) and an upgrade note.
- **Not a stronger guarantee.** The checks stay heuristic: the tenant check is still a presence test (plan/issue for deterministic rewriting), and a read-only database role plus database-level tenant enforcement (RLS) remain the real controls. Docs must not present the new structure as more than tidier enforcement.
- **Integrity of the verdict.** The host stores the template, so it can strip the verdict. That is acceptable: the host is trusted, and enforcement at rebind exists to prevent accidental replay, not tampering. No signing.

## When to revisit

- A check needs inputs that don't fit the candidate (e.g. live database metadata).
- A third-party check becomes a real requirement (then consider Alternative D).
- Deterministic tenant predicate rewriting lands. The tenant check may then become a rewrite plus a verification step, which could change how the decision table treats it.

## Related

- PR #186 (tenant enforcement fails closed; the review discussion that led here), #197 (tenant binding), #192 (sensitivity overrides), #190 (dialect-aware lexer), #270 (subtree scope).
- ADR 0009 (Studio local API protection), ADR 0006 (AI providers).
- `docs/contracts/tenant-policy.md`, `docs/contracts/sensitive-fields-and-modes.md`, `apps/docs-site/src/content/docs/reference/core-api.mdx` (`bindPreparedQuery`).
