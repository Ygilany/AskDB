---
"@askdb/core": minor
"askdb": patch
"@askdb/docs-site": patch
---

A tenant policy that doesn't match `schema.json` now fails the load under `enforcement: strict`, and is reported under `warn` (ADR 0023, #332).

`loadSchema()` and `loadSchemaFromJson()` check every ID in `tenant-policy.md` against `schema.json`. Under `strict`, an orphaned column or foreign key ID, a hierarchy cycle, or a root named in `parent`, `hierarchy`, `scopeThrough` or a polymorphic `mapping` that `roots` doesn't declare throws `SchemaParseError` naming the file and the IDs. `@askdb/enrich`'s `saveTenantPolicy()` (Studio's Save) refuses the same policy. Under `warn` these load in `schema.tenantPolicy.warnings`, as before. A root, scoped, polymorphic or global table that `schema.json` doesn't have stays a warning in both modes, and an entry for a removed table now reports only the table, not each of its columns.

`ask()` logs the new `AskDbLogEvent.TenantPolicyWarnings` (`askdb.tenant.policy_warnings`) once per loaded schema when its policy has warnings, with `enforcement`, `warningCount` and `warnings`. It logs at `warn` level through the new optional `AskDbLogger.warn`, which `createAskDbLogger()` implements, and falls back to `info` for a logger without it. New export: `formatTenantPolicyWarning(warning)`, one line per problem.

`askdb introspect --out` checks an existing `tenant-policy.md` against the `schema.json` it just wrote and prints what no longer matches on stderr. The exit code stays 0.

**Upgrade notes (breaking):** a strict policy that loads today with an orphaned column or foreign key, a cycle or an undeclared root now throws `SchemaParseError` from `loadSchema()`, `createAskDb()` and the HTTP API (400 `schema_parse_error`). Studio can't open that workspace until the file is fixed. Update `tenant-policy.md` to match `schema.json`; the error lists every ID to change.
