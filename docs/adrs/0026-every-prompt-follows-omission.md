# ADR 0026 — Every prompt follows `ask()`'s omission rule; the tenant policy block is the one exception

## Status

Accepted (2026-11-05; amended 2026-11-05). The maintainer settled #624 and #625 in the 2026-11-05 planning round (each issue's "Decision (2026-11-05)" section). The coordinating thread took this work's plan recommendations the same day. Implemented in the PR that closes #601, #624 and #625: `askSampleQuestion` and `suggestForSource` in `apps/studio/src/server.ts`, `buildEnrichmentUserPrompt` in `packages/core/src/enrichment/prompt.ts`, and `buildSuggestionTarget` and `buildSuggestionContext` in `packages/enrich/src/suggest.ts`. Contract: [`sensitive-fields-and-modes.md` → Which prompts follow omission](../contracts/sensitive-fields-and-modes.md#which-prompts-follow-omission). Amended 2026-11-05 (#667): core's enrichment types take `NormalizedV2Table`, not the raw `V2Table` (see Decision and Options considered). Amended 2026-11-06 (#771): the tenant policy block names only the tables the prompt shows (see Amendments).

## Context

`modes.omitSensitiveFromPrompt` is a floor: `@askdb/client`, the CLI and the HTTP API apply it to every `ask()` call. Three paths that put schema names in front of a model did not:

- **Studio's Playground** (`POST /api/ask`) called `ask()` without `omitSensitiveIdentifiersFromNlToSqlPrompt`, and `ask()` reads no config (#601).
- **Studio's enrichment suggestions** (`POST /api/suggest` → `suggestEnrichment`) listed every column of the target table as `name type [sensitive]`, with no omission option (#625). The tables came from `schema.json` through `@askdb/enrich`'s `Workspace`, so a column made sensitive in table front-matter, which is what Studio's Sensitivity tab writes, wasn't even tagged.
- **The tenant policy block** that `buildTenantPromptBlock` adds to the NL→SQL prompt names every scope, join-path, polymorphic and root column the policy front-matter lists, sensitive or not (#624). The tenant check needs the model to filter on those columns.

ADR 0021 made Studio's tenant-policy draft follow `ask()`'s rule through core's formatter, and ADR 0022 extended omission to text that names a sensitive column. Embedding calls are out of scope: they don't read the setting, and the RAG chunker leaves sensitive content out of the index by default unless `includeSensitiveDescribable` opts in.

## Decision

- **The Playground** passes `omitSensitiveIdentifiersFromNlToSqlPrompt: true` to `ask()` when `modes.omitSensitiveFromPrompt` is on, as `@askdb/client` does. It has no per-request override, and it doesn't move onto `createAskDb` here (#364).
- **Enrichment suggestions read effective sensitivity.** `buildSuggestionTarget` and `buildSuggestionContext` in `@askdb/enrich` take `loadSchema()`'s `NormalizedSchemaV2` instead of a `Workspace`, so front-matter escalation and table-wide inheritance reach the prompt.
- **Core's enrichment types require a normalized table.** `EnrichmentTarget.table` and `EnrichmentContext.neighbors` take `NormalizedV2Table`, not the raw `V2Table`, so a table read straight from `schema.json` doesn't compile as a target or neighbor (#667). The type requires a `sensitive` flag on the table and every column, but it can't prove where the flags came from. `loadSchemaFromJson()` of a bare `schema.json` typechecks with no front-matter flags, so the docs tell hosts to load the schema directory or a bundle with `loadSchema()`. The type is the only check: core adds none at runtime.
- **The enrichment prompt lists the target table with `formatSchemaV2ForNlToSql`**, over a copy that keeps only the physical fields. Sensitive columns are tagged `(sensitive)` by default. With `omitSensitiveIdentifiersFromPrompt` (on `SuggestEnrichmentDeps`, and on `buildEnrichmentUserPrompt`'s options) they are withheld, and a sensitive table keeps only its name, as in `ask()`'s prompt. Neighbor tables keep their name and column count. Studio passes `modes.omitSensitiveFromPrompt`.
- **A sensitive column can't be the target under omission.** The prompt would have to name it, so `buildEnrichmentUserPrompt` throws `SensitiveEnrichmentTargetError` (an `AskDbError`) before any model call, and Studio answers 400. Neither message names the column.
- **The tenant policy block is the one exception.** Under omission it still names the tenant columns the policy lists, sensitive ones included, because the tenant check requires a predicate on them. The sensitive-fields contract, the tenant-policy contract, the docs-site privacy page and the review profile all say so.

## Options considered

- **Leave enrichment unchanged and correct the review profile instead (#625, option B).** Rejected by the maintainer. Enrichment is authoring on the operator's own schema, but the setting is a floor for every prompt sent to a language model, and a second rule invites drift.
- **Keep `Workspace` in the builders and merge the front-matter flags in `@askdb/enrich`.** Rejected: a third copy of the loader's escalation rule, after `loadSchema()` and Studio's `web/lib/sensitivity.ts`.
- **Keep enrichment's own `name type [pk] [sensitive]` lines and copy the omission rule into them.** Rejected for the reason ADR 0021 gives: the tag, the stub and the omission rule would have two homes.
- **Send a sensitive column's suggestion prompt without its name.** Rejected: the model would suggest blind.
- **Also disable Studio's Suggest button on sensitive columns under omission.** Deferred. It needs the mode in the workspace DTO and a UI change, and the 400's message already explains the refusal.
- **A branded table type that only `loadSchema()` can create (#667).** Rejected: it would prove where the flags came from, which `ask()` doesn't check for its own schema either, and every table built by hand, test fixtures included, would need a cast.
- **A runtime check in core that every `sensitive` flag is a boolean (#667).** Rejected: introspection writes `sensitive` on every table and column of `schema.json`, so the check can't tell a raw table from a loaded one. It would add a public error that catches nothing.
- **Withhold sensitive columns from the tenant policy block too (#624, option B).** Rejected by the maintainer. The model then can't write the tenant predicate for a sensitive tenant-scoped table, and the tenant check rejects the SQL, so omission turns into a failure for every such table. The block names identifiers the check requires, never values.

## Consequences

- The enrichment prompt uses `ask()`'s table format (`TABLE public.users` with `- col type (flags)` lines) in both modes, so suggestions can differ from earlier ones for the same table.
- `buildSuggestionTarget(schema, source)` and `buildSuggestionContext(schema, tableId)` are a breaking change to `@askdb/enrich`, which stays 0.x (minor changeset). Studio is their only caller in the repository.
- Narrowing `EnrichmentTarget` and `EnrichmentContext` is a breaking change to `@askdb/core`, which goes to 1.0. It lands before the rc.1 API freeze, with a minor changeset (#667). A table built by hand must set `sensitive` on the table and `sensitive` and `primaryKey` on every column.
- Under omission, a column of a sensitive table can't get a suggestion either, because `loadSchema()` marks every column of a sensitive table sensitive.
- Omission doesn't keep a column the tenant policy names away from the model. Tenant columns are usually keys such as `org_id`, not the attributes omission is for; the database role stays the boundary (ADR 0012).

## Amendments

**2026-11-06 — The tenant policy block names only the tables the prompt shows (#771):** the exception above still holds, but only for the tables the block names. Since #771 it leaves out tables marked `tracked: false` and, under retrieval, tables retrieval left out, except a tracked table on a join path that a shown table needs. Under omission it still names the sensitive tenant columns of the tables it shows. [ADR 0038](0038-prompt-hints-name-no-schema-table.md)'s amendment records the rule.
