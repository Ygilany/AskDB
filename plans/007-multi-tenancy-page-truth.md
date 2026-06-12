# Plan 007: Make the multi-tenancy docs page match the real tenant-policy schema and `TenantScope` API

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 0f0c481..HEAD -- apps/docs-site/src/content/docs/guides/multi-tenancy.mdx`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live file before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (docs-only; no source code changes)
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `0f0c481`, 2026-06-12

## Why this matters

The public docs page `guides/multi-tenancy.mdx` shows a `tenant-policy.md`
front-matter format and a `tenantScope` argument shape that do **not exist**
in the codebase. The real zod schemas are `.strict()`, so a user who
copy-pastes the documented YAML gets every key rejected, and the documented
`access: { kind: "exact" }` scope is not one of the four real access kinds.
Tenancy is a headline safety feature — wrong examples here cost user trust
disproportionately. The maintainer also asked that this page explain the
meaning and use of **every** front-matter property, not just show an example.

## Current state

Files (read all of them before editing):

- `apps/docs-site/src/content/docs/guides/multi-tenancy.mdx` — the page to fix
  (the ONLY file you will modify).
- `packages/core/src/schema/v2/tenant-policy.ts` — source of truth:
  - `tenantPolicyFrontmatterSchema` (lines ~72–83): strict zod object with
    required `schemaId` (string), `enforcement` (`"strict" | "warn"`),
    `roots` (min 1); optional `hierarchy`, `scopedTables`,
    `polymorphicTables`, `globalTables` (array of strings).
  - Runtime scope types (lines ~120–177): `TenantScope = { access, tenantFilters?, context? }`
    where `access` is a discriminated union on `kind`:
    `"ids" { tenantRoot, ids }` · `"subtree" { tenantRoot, rootIds, includeDescendants: true }`
    · `"multi_root" { scopes: [{ tenantRoot, ids }] }` · `"global" { reason }`.
- `docs/contracts/tenant-policy.md` — the format contract with a full example
  and per-field meaning tables. Mirror its field semantics; do not contradict it.
- `fixtures/schemas/agency-multi-tenant.schema/tenant-policy.md` — a real,
  loader-validated policy file you can crib syntax from.
- `packages/core/src/ask.ts` (lines ~129–143, ~195–202) — `tenantScope` and
  `tenantSqlMode` options: default mode is `"sql-only"` (inlines literal
  values); `"sql-params"` converts to positional `$N` parameters and the
  result carries `tenantParams` when parameters exist.

### Wrong content currently on the page (all of it must go)

`multi-tenancy.mdx:32-50` — invalid front-matter (every key below is rejected
by the strict zod schema; `schemaId` and `enforcement` are missing; entries
use bare table names instead of stable IDs):

```yaml
---
tenantRoots:
  - table: organizations
    tenantIdColumn: id

scopedTables:
  - table: projects
    tenantForeignKey: organization_id
    tenantRoot: organizations
  - table: documents
    tenantForeignKey: organization_id
    tenantRoot: organizations

globalTables:
  - table: plan_tiers
  - table: countries
---
```

`multi-tenancy.mdx:56-74` — invalid `tenantScope` (kind `"exact"` does not
exist; `tenantRoot`/`tenantIds` must live *inside* `access`, and the field is
`ids`, not `tenantIds`):

```ts
const { sql, tenantParams } = await ask({
  question: "How many documents did we create this month?",
  schema,
  dialect: "postgres",
  model,
  tenantScope: {
    access: { kind: "exact" },
    tenantRoot: "organizations",
    tenantIds: ["org_abc123"],
  },
  tenantSqlMode: "sql-params",
});
```

`multi-tenancy.mdx:91` — prose repeating the wrong shape:
`a tenant scope of \`{ tenantRoot: "organizations", tenantIds: ["org_abc123"] }\``

`multi-tenancy.mdx:106-116` — Studio JSON example repeating `"kind": "exact"`
and the flat (non-nested) shape.

### Repo conventions for this page

- Astro Starlight MDX. Pages open with `<p class="doc-eyebrow">` and
  `<p class="doc-lede">`, use `##` sections, GitHub-flavored tables, and end
  with a `<div class="home-path-grid">` "Read next" block. Keep all of that
  structure; you are correcting content, not redesigning the page.
- Root-absolute internal links like `/concepts/safety-boundaries/` are correct
  (a remark plugin rebases them at build time).

## Commands you will need

| Purpose | Command (run from repo root) | Expected on success |
|---|---|---|
| Install (only if `node_modules` missing) | `pnpm install` | exit 0 |
| Docs typecheck | `pnpm --filter docs-site lint` | exit 0 (astro check) |
| Docs build + base-path link check | `pnpm --filter docs-site test` | exit 0 |

## Scope

**In scope** (the only file you may modify, plus the index):
- `apps/docs-site/src/content/docs/guides/multi-tenancy.mdx`
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch):
- `docs/contracts/tenant-policy.md` and `packages/core/**` — the docs page
  must follow the code, never the reverse.
- `fixtures/**`.
- Other docs pages that mention tenancy (`run-safely-in-prod.mdx`,
  `safety-boundaries.mdx`, `author-your-schema.mdx`) — their tenancy mentions
  are prose-level and correct enough; plan 008 handles unrelated fixes.

## Git workflow

- Work on the current branch `Ygilany/fix-docs-review-items` (this branch
  exists specifically for docs-review fixes). There is a pre-existing
  uncommitted change to `apps/docs-site/src/content/docs/index.mdx` (MIT →
  Apache 2.0); leave it in the working tree untouched — do not revert it, and
  do not include it in your commit unless the operator says otherwise.
- Commit message style (from `git log`): conventional commits, e.g.
  `docs(site): correct multi-tenancy policy format and TenantScope examples`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Replace the hand-written policy example

In the "## Authoring the policy" section, replace the YAML block (current
lines 32-50) with a valid example that keeps the page's existing SaaS
narrative (organizations / projects / documents). Use exactly this content:

````markdown
You can also write `tenant-policy.md` by hand. The front-matter is YAML,
validated strictly when the schema artifact loads — unknown keys are
rejected, and every table or column reference uses the **stable IDs** from
`schema.json` (`table:public.projects`, `table:public.projects#organization_id`),
never bare names. Example for a simple SaaS schema:

```yaml
---
schemaId: my-app
enforcement: strict

roots:
  - id: table:public.organizations
    tenantIdColumn: table:public.organizations#id
    label: Organization

scopedTables:
  - id: table:public.projects
    scopeThrough:
      - root: table:public.organizations
        column: table:public.projects#organization_id
  - id: table:public.documents
    scopeThrough:
      - root: table:public.organizations
        column: table:public.documents#organization_id

globalTables:
  - table:public.plan_tiers
  - table:public.countries
---

# Tenant Policy

Organizations are the only tenant level. Projects and documents carry a
direct `organization_id`; plan tiers and countries are shared lookups.
```

The markdown body below the front-matter is free-form business context; the
`Hierarchy`, `Scope rules`, and `Sensitive interactions` H2 sections are
recognized and fed into prompt assembly.
````

**Verify**: `grep -n "tenantRoots\|tenantForeignKey" apps/docs-site/src/content/docs/guides/multi-tenancy.mdx` → no matches.

### Step 2: Add a "Field reference" section

Immediately after the example from Step 1 (still inside / after the
"Authoring the policy" section), add a new `## Field reference` section
explaining every front-matter property. Use this content (it is condensed
from `docs/contracts/tenant-policy.md` — keep the semantics identical):

````markdown
## Field reference

Top-level front-matter fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `schemaId` | yes | Must match the `schemaId` in the artifact's `schema.json`. Ties the policy to one schema. |
| `enforcement` | yes | `strict` rejects any query whose tenant filter can't be proven; `warn` returns the SQL with `tenantWarnings` instead. Start with `strict`. |
| `roots` | yes | The tables that *are* tenants (at least one). Everything else is scoped relative to a root. |
| `hierarchy` | no | Parent→child edges between roots (agency → sub-agency → client). Must form a cycle-free graph. |
| `scopedTables` | no | Tables whose rows belong to a tenant, and how to reach the root from them. |
| `polymorphicTables` | no | Tables that reference different tenant types via a discriminator column pair. |
| `globalTables` | no | Stable table IDs intentionally exempt from tenant filtering (shared lookups). |

Tables that appear in none of `scopedTables`, `polymorphicTables`, or
`globalTables` are classified **unknown** — they trigger warnings, and in
`strict` mode block queries that touch them. Classify everything.

`roots[]` — each entry is one tenant-identifying table:

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Stable table ID (e.g. `table:public.organizations`). |
| `tenantIdColumn` | yes | Stable column ID of the root's identifier — the value your app passes at runtime. |
| `label` | yes | Human-readable name used in prompts and named placeholders (`Organization` → `:tenant_organization_ids`). |
| `parent.root`, `parent.foreignKey` | no | When this root is a child of another root: the parent's table ID and the FK column linking to it. |

`scopedTables[]` — operational tables constrained by a tenant:

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Stable table ID. |
| `scopeThrough` | yes | One or more paths from this table to a root. Each path has `root` plus **exactly one of** `column` or `join`. |
| `scopeThrough[].column` | one of | Stable column ID of a direct tenant FK on this table (`table:public.projects#organization_id`). |
| `scopeThrough[].join` | one of | A list of `{ from, to }` stable-column-ID steps when the table reaches its root through other tables (e.g. `appointments → clients`). |

A table may declare several `scopeThrough` paths (e.g. scoped directly by
`agency_id` *and* through `client_id` → clients); the validator accepts any
path that satisfies the caller's scope.

`polymorphicTables[]` — type + id discriminator pairs:

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Stable table ID. |
| `typeColumn` | yes | Stable column ID of the discriminator (e.g. `table:public.notes#owner_type`). |
| `idColumn` | yes | Stable column ID of the polymorphic FK (e.g. `table:public.notes#owner_id`). |
| `mapping` | yes | Maps each literal `typeColumn` value to a tenant root's table ID (`agency: table:public.agencies`). |

The full contract — including hierarchy validation rules and the five
scoping patterns these fields express — lives in
[`docs/contracts/tenant-policy.md` on GitHub](https://github.com/Ygilany/AskDB/blob/main/docs/contracts/tenant-policy.md).
````

**Verify**: `grep -c "^## " apps/docs-site/src/content/docs/guides/multi-tenancy.mdx` → count is exactly one higher than before your edits (the page gained one `## Field reference` section).

### Step 3: Fix the `ask()` scope example

In "## Asking with a tenant scope", replace the code block (current lines
56-74) with:

````markdown
```ts
import { ask } from "@askdb/core";

const { sql, tenantParams } = await ask({
  question: "How many documents did we create this month?",
  schema,
  dialect: "postgres",
  model,
  tenantScope: {
    access: {
      kind: "ids",
      tenantRoot: "table:public.organizations",
      ids: ["org_abc123"],
    },
  },
  tenantSqlMode: "sql-params",
});

// Execute with the tenant parameters bound:
const result = await pool.query(sql, tenantParams);
```

`access.kind` selects the scope shape: `ids` (exact tenant IDs on one root —
the common case), `subtree` (a root's IDs plus all descendants:
`{ kind: "subtree", tenantRoot, rootIds, includeDescendants: true }`),
`multi_root` (IDs across several roots), or `global` (deliberately unscoped,
with a `reason` string for the audit trail). The optional `context` field
carries advisory metadata (role, department) into the prompt, and
`tenantFilters` lets the host pre-resolve polymorphic scope.
````

**Verify**: `grep -n '"exact"\|kind: "exact"\|tenantIds' apps/docs-site/src/content/docs/guides/multi-tenancy.mdx` → no matches.

### Step 4: Fix the inline scope mention in "What gets rewritten"

Replace the sentence at current line 91 (`With the policy above and a tenant
scope of \`{ tenantRoot: "organizations", tenantIds: ["org_abc123"] }\`, …`)
with:

> With the policy above and an access scope of
> `{ kind: "ids", tenantRoot: "table:public.organizations", ids: ["org_abc123"] }`,
> the same question generates:

Keep both SQL blocks in that section unchanged.

**Verify**: `grep -n "tenantRoot: \"organizations\"" apps/docs-site/src/content/docs/guides/multi-tenancy.mdx` → no matches.

### Step 5: Fix the Studio JSON example

In "## Testing in Studio", replace the JSON block (current lines 108-114) with:

```json
{
  "access": {
    "kind": "ids",
    "tenantRoot": "table:public.organizations",
    "ids": ["org_abc123"]
  }
}
```

**Verify**: `grep -n '"kind": "exact"' apps/docs-site/src/content/docs/guides/multi-tenancy.mdx` → no matches.

### Step 6: Mention enforcement modes where the page over-claims

Current line 54 says "every `ask()` call **must** include a `tenantScope`" —
that is true, but add the enforcement nuance. Replace the first paragraph of
"## Asking with a tenant scope" with:

> When the policy exists, every `ask()` call must include a `tenantScope`.
> AskDB validates the scope against the policy and binds it into the
> generated SQL. With `enforcement: strict`, a query whose tenant filter
> can't be proven is rejected; with `enforcement: warn`, the SQL is returned
> together with `tenantWarnings` for your application to act on.

**Verify**: `grep -n "tenantWarnings" apps/docs-site/src/content/docs/guides/multi-tenancy.mdx` → exactly 1 match.

### Step 7: Build the site

**Verify**:
- `pnpm --filter docs-site lint` → exit 0.
- `pnpm --filter docs-site test` → exit 0 (builds with `ASTRO_BASE=/AskDB`
  and runs the base-path link checker).

## Test plan

This is a docs-only change; the "tests" are the build gates above plus the
greps in each step. Additionally run one consistency sweep:

- `grep -rn "kind: \"exact\"\|tenantRoots\|tenantForeignKey\|tenantIds" apps/docs-site/src/` → no matches anywhere in the site.

## Done criteria

ALL must hold:

- [ ] `pnpm --filter docs-site lint` exits 0
- [ ] `pnpm --filter docs-site test` exits 0
- [ ] `grep -n 'kind: "exact"\|"kind": "exact"\|tenantRoots\|tenantForeignKey\|tenantIds' apps/docs-site/src/content/docs/guides/multi-tenancy.mdx` returns no matches
- [ ] The page contains a `## Field reference` section covering `schemaId`, `enforcement`, `roots`, `hierarchy`, `scopedTables`, `polymorphicTables`, `globalTables`
- [ ] `git status` shows modifications only to `apps/docs-site/src/content/docs/guides/multi-tenancy.mdx`, `plans/README.md`, and the pre-existing `index.mdx` change
- [ ] `plans/README.md` status row for 007 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The live `multi-tenancy.mdx` no longer matches the "Current state" excerpts
  (someone else already fixed it — verify and mark the plan DONE or BLOCKED).
- `tenantPolicyFrontmatterSchema` in
  `packages/core/src/schema/v2/tenant-policy.ts` differs from the field list
  in this plan (e.g. a field was added/renamed after `0f0c481`) — the plan's
  tables would document a stale schema.
- `pnpm --filter docs-site test` fails for a reason unrelated to your edits
  (e.g. network-dependent font fetch); report the error rather than patching
  build config.

## Maintenance notes

- The Field reference tables duplicate (in condensed form)
  `docs/contracts/tenant-policy.md`. If the contract gains fields, both must
  be updated — a reviewer should check the contract file on any future
  tenancy PR.
- Reviewers should diff the YAML example against
  `fixtures/schemas/agency-multi-tenant.schema/tenant-policy.md` syntax (IDs,
  nesting) rather than re-deriving from memory.
- Deferred: the page does not document `subtree`/`multi_root` end-to-end
  examples or named-placeholder output (`:tenant_organization_ids`); the
  contract doc covers them. Add only if users ask.
