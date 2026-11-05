# ADR 0023 — A tenant policy that doesn't match `schema.json` fails the load under `strict`

## Status

Accepted (2026-09-29, maintainer decision on #332; details settled in the #332 plan round on 2026-11-05). Implemented in `packages/core/src/schema/v2/tenant-policy-loader.ts` (`normalizeTenantPolicy`), `packages/core/src/sql/tenant-policy-warnings.ts` and `apps/cli/src/introspect.ts`.

## Context

`normalizeTenantPolicy` checks `tenant-policy.md` against `schema.json` and collects every problem into `NormalizedTenantPolicy.warnings`: table, column and foreign key IDs the schema doesn't have, hierarchy cycles, and roots named in scope, hierarchy or mapping that the policy doesn't declare. Until #332 nothing outside Studio's Tenancy page read that list. `loadSchema()` didn't throw, `ask()` didn't log, and the CLI and HTTP API printed nothing. A strict policy with a renamed `scopeThrough` column or a cycle loaded quietly.

The tenant policy contract called these problems validation errors ("Cycles are a validation error"; a renamed column is "Reported as validation errors"), but said a removed table's references are "flagged as warnings". The code treated all of them as warnings no one saw.

## Options considered

### A. Errors in every mode

`loadSchema()` throws on any problem except a removed table, under `strict` and `warn` alike. Rejected: `warn` exists for adopting a policy step by step, and a host that chose it asked for findings, not refusals.

### B. Warnings in every mode, surfaced

Keep load-and-continue everywhere, reword the contract to "warnings", and surface them in logs and the CLI. Rejected: under `strict`, tenant checks would run against a policy whose scope columns or hierarchy are wrong, which is the silent fail-open #186 removed for malformed policies.

### C. Decided by the policy's `enforcement` (chosen)

`strict` fails closed and `warn` loads and reports. The policy already states how strictly it wants to be enforced, so the load follows it.

## Decision

- **Errors under `strict`.** An orphaned column or foreign key ID, a hierarchy cycle, and a root named in `scopeThrough`, `hierarchy`, `parent` or a polymorphic `mapping` that `roots` doesn't declare make `normalizeTenantPolicy` throw `SchemaParseError`. The loader adds the file path. The message lists every error with its IDs and says to update `tenant-policy.md` to match `schema.json`. Cycle detection walks every parent edge, from `roots[].parent` and `hierarchy`, because a root may have more than one parent.
- **Warnings in every mode.** A root, scoped, polymorphic or global table that `schema.json` doesn't have stays in `warnings` and the schema loads. An entry for a removed table reports only the table: its own column IDs went with it, and it scopes nothing. A join on a table that still exists, running through a removed table, is still an error.
- **Under `warn`**, every problem loads as a warning.
- **ADR 0010 keeps SQL findings.** `decide()` stays the only interpreter of `strict` and `warn` for findings about generated SQL. This check reads `enforcement` for a different question, whether the policy itself loads, before any SQL exists. ADR 0010 and its index row say so.
- **One check for every caller.** The check lives in `normalizeTenantPolicy`, so the directory loader, the bundle loader and `@askdb/enrich`'s `saveTenantPolicy` (Studio's Save) refuse the same policies.
- **The log event.** `ask()` logs `AskDbLogEvent.TenantPolicyWarnings` (`askdb.tenant.policy_warnings`) once per loaded schema when its policy has warnings, at `warn` level (`AskDbLogger.warn`, falling back to `info`). `loadSchema()` takes no logger, so the first `ask()` that receives the schema logs it. The event carries `enforcement`, `warningCount` and `warnings`: schema artifact metadata only (table and column IDs, and a polymorphic `mapping` key, which the policy declares and every prompt already carries), never query text or row values.
- **The CLI.** `askdb introspect --out` loads the directory it wrote when it holds `tenant-policy.md`, and prints what no longer matches on stderr. The exit code stays 0, because the write succeeded.
- `formatTenantPolicyWarning(warning)` gives one line per problem. The strict error, the log message and the CLI use it.

## Consequences

- A strict policy that loads today with any of these problems starts throwing. The `@askdb/core` changeset is a minor bump and names the change.
- `ask()`'s result gets no new field: the host already holds `schema.tenantPolicy.warnings`. The HTTP API changes nothing: a strict error reaches clients as the existing 400 `schema_parse_error`, and warnings go to the server log.
- `askdb ask` takes no tenant scope, so on a schema with a tenant policy it stops at `TenantScopeError` and prints nothing for the policy. Its `--verbose` log still carries the event, which `ask()` logs before it checks the scope.
- Studio can't open a workspace whose strict policy has errors, the same as a malformed `tenant-policy.md` today. The fix is to edit the file. Recovering inside Studio is a separate issue (#640). A Studio that is already open when a re-introspection breaks its policy can still save the fix: `saveTenantPolicy()` checks `schema.json` on disk, not the workspace in memory.
- Studio's Tenancy page lists one warning for a removed table instead of one per column it named.
