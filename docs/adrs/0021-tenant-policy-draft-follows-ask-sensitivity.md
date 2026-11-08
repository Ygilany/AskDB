# ADR 0021 — Studio's tenant-policy draft follows `ask()`'s sensitive-column rule and reports withheld keys as warnings

## Status

Accepted (2026-11-04, maintainer decision on #324's plan; recorded in [#324's comment](https://github.com/Ygilany/AskDB/issues/324#issuecomment-6649843150)). Implemented in PR #612: `tenantPolicySchemaForPrompt` and `suggestTenantPolicyDraft` in `apps/studio/src/server.ts`, and the **Withheld from the model** card in `apps/studio/src/web/views/tenancy/TenancyPage.tsx`. Contract: [`sensitive-fields-and-modes.md`](../contracts/sensitive-fields-and-modes.md).

> **Amendment (2026-11, #898):** core's formatter now prints foreign keys (#349's step 5, taken over by #898; [ADR 0043](0043-default-prompt-carries-foreign-keys-and-concepts.md)), so Studio passes each tracked table's `relationships` to it and its `Foreign keys:` block is gone. The formatter's rule is the one this ADR applied: a key prints only when both of its columns are listed. Studio still writes the `warnings` for the keys omission withholds.

## Context

Studio's **Draft with AI** (`POST /api/suggest-tenant-policy`) asks a model to propose a `tenant-policy.md`. Until #324 it built its prompt from the raw `schema.json` columns, so it listed every column by name. It ignored the sensitive flags in `schema.json`, the escalation in table front-matter, and `modes.omitSensitiveFromPrompt`, which `ask()` and the hosts built on `@askdb/client` all honour.

Tenant inference needs keys and foreign keys, not sensitive attributes. But a sensitive table's keys are themselves sensitive, because `loadSchema()` marks every column of a sensitive table. So withholding them can hide a key the policy needs, such as `org_id` on a sensitive `users` table.

The NL→SQL formatter in core, `formatSchemaV2ForNlToSql`, prints no foreign keys (#349, step 5, plans to add them). The tenant draft needs them.

## Decision

- The draft builds its prompt from `loadSchema()`. That normalized schema already applies every source of sensitivity: `schema.json`, front-matter escalation and table-wide inheritance.
- It lists tables and columns with core's `formatSchemaV2ForNlToSql`, over a copy of the tracked tables that keeps only the physical fields. So sensitive columns are tagged `(sensitive)` by default and withheld when `modes.omitSensitiveFromPrompt` is on, the same as in `ask()`. A sensitive table gets core's placeholder line, and untracked tables are left out.
- The draft sends no describable text: no descriptions, aliases or common query language.
- Studio adds a `Foreign keys:` block, listing a foreign key only when both of its columns are listed. This is the formatter's omission rule applied to the relationships, until core prints foreign keys itself (#349, step 5). Then Studio uses core's lines and deletes its block.
- When omission withholds a primary key, or a foreign key that touches a withheld column, the response's `warnings` names it, and the review screen shows it in a **Withheld from the model** card. Studio writes the warnings, never the model, and nothing is added to the draft body.

## Options considered

- **Always withhold sensitive columns in the draft, whatever the mode.** Rejected. It creates a second rule beside `ask()`'s. It also hides the keys of a sensitive table in the default mode, where the operator chose to send them tagged.
- **Keep Studio's own `CREATE TABLE` rendering and copy the omission rule into Studio.** Rejected: the tag, stub and omission rule would have two homes (`docs/integration/reuse-core-phase-3.md`).
- **Have core report the IDs it withheld, or print foreign keys now.** Deferred. Either is a new or changed core API for one caller, and #349 already plans the foreign-key lines. Studio's foreign-key filter reads only the `sensitive` flag that `loadSchema()` sets, which is the formatter's own test.
- **Tell the user by adding a note to the draft body's `## Sensitive interactions` section.** Rejected. The note would be saved to `tenant-policy.md`, which RAG indexes. A note naming a sensitive column (`users.id`) makes ADR 0017 drop that section from the index. The note would also sit inside model-written text, where the user can't tell Studio's words from the model's.
- **Withhold silently.** Rejected: the draft then can't scope a table through a withheld key, and nothing says why.

## Consequences

- The draft prompt now uses `ask()`'s table format (`TABLE public.users` with `- col type (flags)` lines) in place of `CREATE TABLE`, so drafts can differ from earlier ones for the same schema.
- In omit mode, a sensitive table that carries tenant scope may come back unscoped. The warning names its keys so the user can add them to the policy by hand.
- Until #349, step 5 lands, Studio's foreign-key block holds a copy of the formatter's omission rule. If core's rule changes, change both.
- The response type `SuggestTenantPolicyResponse` gains a required `warnings: string[]`. Only Studio's own web client reads it.
- Studio's Playground still ignores `modes.omitSensitiveFromPrompt` (#601). This ADR covers the tenant draft only.
