# ADR 0033 — An error code nothing reports leaves before 1.0, or is thrown

## Status

Accepted (2026-11-05, the coordinating thread's answer to Stop 1 of #682, Q1 and Q2). Implemented in PR #695. It applies ADR 0031's rule for unused exports to the members of public error-code unions.

## Context

1.0 freezes AskDB's public types: after it, removing a member from an exported union needs a major. ADR 0031 covers whole exports; this covers the codes inside them.

The #287 reference audit found five members of `@askdb/core`'s error-code unions that none of AskDB's own code paths reports:

- **`GLOBAL_WITHOUT_REASON`** (`TenantScopeRejectionReason`). A `global` scope with no `reason` failed the zod shape check first and threw `INVALID_SCOPE_SHAPE`, and a blank `reason` passed.
- **`INCOMPATIBLE_JOIN_SCOPES` and `CROSS_TENANT_WITHOUT_GLOBAL`** (`TenantGuardrailRuleCode`). No check emits them. A custom `AskDialect` could report them through `tenantGuardrail.warnings`, and `ask()` would decide them under the policy's `enforcement`, but AskDB itself never checks either rule.
- **`INVALID_NAME` and `RESERVED_NAME`** (`QueryParameterRejectionReason`). Only the internal parameter-manifest parser uses them, as the reason of a result that `ask()` logs at debug level and drops. Nothing throws them.

A host that switches on these unions writes branches that can't run, and the types promise checks that AskDB doesn't run.

## Options considered

- **A. Remove the code (chosen for four).** A minor changeset and an upgrade entry name each one. Code that names a removed code stops compiling, and nothing changes at run time.
- **B. Throw the code where it belongs (chosen for `GLOBAL_WITHOUT_REASON`).** Its rule, "global access must say why", is a few lines in `validateTenantScope()`. Rejected for the two tenant rules: each needs new guardrail logic, a far larger change than the freeze allows, and a later minor can add a checked rule.
- **C. Keep the codes as reserved for future use.** Rejected: the types would keep promising checks that don't exist, and a host's exhaustive `switch` would keep dead branches through 1.x.

## Decision

- Before 1.0, a member of a public error-code union that none of AskDB's own code paths reports is removed in one step, unless its rule is cheap enough to enforce now, in which case AskDB throws it. Each code is decided on its own.
- `validateTenantScope()` throws `TenantScopeError` with `GLOBAL_WITHOUT_REASON`, before the shape check, for a `global` scope whose `reason` is missing, isn't a string, or is blank. `ask()`, `bindPreparedQuery()` and `expandTenantScope()` all validate a scope through it. The exported `tenantScopeSchema` is unchanged.
- An internal parser keeps its own reason strings in its own union, outside the public error types.
- The docs-site `test:errors` check keeps `errors.ts` and the core and client reference pages in step both ways: every class and code has a row, and every row names a declared class or code.

## Consequences

- A host that names a removed code fails to compile after it upgrades, and so does a custom `AskDialect` that reports one of the two tenant rules in `tenantGuardrail.warnings`. The beta.46 upgrade entry says what to use instead.
- A host that passed a blank `global` reason now gets `TenantScopeError` with `GLOBAL_WITHOUT_REASON`.
- After 1.0, adding a code is a minor and removing one is a major. A new code lands with its reference row, because `test:errors` fails without it.
