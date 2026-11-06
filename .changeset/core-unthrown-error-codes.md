---
"@askdb/core": minor
---

**Breaking: the error codes nothing threw are gone** (#682). `TenantGuardrailRuleCode` drops `INCOMPATIBLE_JOIN_SCOPES` and `CROSS_TENANT_WITHOUT_GLOBAL`, and `QueryParameterRejectionReason` drops `INVALID_NAME` and `RESERVED_NAME`. None of AskDB's own checks reported them, so runtime behavior is unchanged, but code that names them no longer typechecks (ADR 0033). A host deletes those branches. A custom `AskDialect` that reported `INCOMPATIBLE_JOIN_SCOPES` or `CROSS_TENANT_WITHOUT_GLOBAL` in `tenantGuardrail.warnings` reports `MISSING_TENANT_PREDICATE` or `UNPROVABLE_SCOPE` instead.

**`GLOBAL_WITHOUT_REASON` is now thrown.** `validateTenantScope()`, and so `ask()`, `bindPreparedQuery()` and `expandTenantScope()`, throws `TenantScopeError` with `GLOBAL_WITHOUT_REASON` for a `global` scope whose `reason` is missing, isn't a string, or is blank. Before, a missing or empty `reason` threw `INVALID_SCOPE_SHAPE`, and a blank one such as `"  "` passed. Give every `global` scope a `reason` that says why it sees every tenant.
