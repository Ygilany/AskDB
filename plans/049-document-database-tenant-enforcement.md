# Plan 049: Document database-level tenant enforcement (Postgres RLS) as the primary path

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 595182d..HEAD -- docs/specs/multi-tenancy.md docs/contracts/tenant-policy.md docs/integration apps/docs-site/src/content/docs/guides/multi-tenancy.mdx apps/docs-site/src/content/docs/guides/run-safely-in-prod.mdx` If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW — documentation only, no code changes.
- **Depends on**: plan 045 (soft). 045 rewrites the guardrail's self-description to match reality; this plan supplies the enforcement story that description points at. They are complementary and can land in either order, but landing 045 first means this page has something accurate to link back to.
- **Category**: docs
- **Planned at**: commit `595182d`, 2026-08-05
- **Breaking**: No.

## Why this matters

AskDB's tenant machinery describes a policy to the model, asks it to comply, and then checks the result with heuristics. Every part of that chain depends on the model cooperating. The check that runs afterward does not parse SQL — it verifies that expected identifiers appear somewhere in the statement, which a query can satisfy while filtering on nothing at all.

There is a well-established way to make tenant isolation actually hold: enforce it in the database, where no generated statement can bypass it. PostgreSQL row-level security applied inside the same read-only transaction that runs the query does exactly that. AskDB's policy then serves its real purpose — grounding the model so it writes *good* queries — while correctness rests on the database rather than on the model's goodwill.

This is currently undocumented. The repo mentions RLS exactly once, in a non-goals list, framed backwards. An integrator following the documentation today has no path to sound multi-tenant isolation.

## Current state

### The single existing RLS mention — `docs/specs/multi-tenancy.md:42`

```
- Row-level security (RLS) DDL generation — tenant predicates are SQL WHERE clauses; RLS is still recommended as a defense-in-depth layer
```

It sits in a non-goals list and frames RLS as the optional extra on top of AskDB's predicates. This plan inverts that: RLS is the enforcement layer, AskDB's predicates are the optimization and the defense in depth. Read the surrounding section before editing — the non-goal ("we do not generate RLS DDL for you") remains true and should survive; only the framing changes.

Confirm this is the only mention:

```bash
grep -rn -i "row.level.security\|ROW LEVEL SECURITY\|\bRLS\b" docs apps/docs-site/src packages/*/README.md
```

At `595182d` this returns `docs/specs/multi-tenancy.md:42` and a passing reference in `apps/docs-site/src/content/docs/concepts/how-askdb-works.mdx`. Read the latter to see whether it needs aligning.

### The existing multi-tenancy guide — `apps/docs-site/src/content/docs/guides/multi-tenancy.mdx`

Its section structure at `595182d`:

```
10:## How it works
16:## Tenant policy concepts
26:## Authoring the policy
71:## Field reference
124:## Asking with a tenant scope
175:## SQL output modes
184:## What gets rewritten
203:## Without a policy
207:## Testing in Studio
223:## Read next
```

The new enforcement material belongs early — a reader needs the trust model before the field reference. Plan to insert a section after `## How it works`.

### Where the execution recipe lives

`docs/integration/` holds the integration recipes: `connectors.md`, `installable-package.md`, `postgres-partitioned-tables.md`, `rag-recipes.md`, `reuse-core-phase-3.md`. Read two of them before writing to match heading depth, code-fence style, and length.

`apps/docs-site/src/content/docs/guides/run-safely-in-prod.mdx` is the production-safety guide and is the natural place to link the new page from.

**Note on plan 038**: that plan (status TODO) adds `docs/integration/executing-generated-sql.md` covering read-only transactions, statement timeouts, and row caps. RLS belongs in the *same* transaction as those. Check whether 038 has landed:

```bash
ls docs/integration/executing-generated-sql.md 2>/dev/null && echo "038 LANDED" || echo "038 NOT LANDED"
```

If it has landed, extend it with an RLS section rather than duplicating the transaction scaffolding. If it has not, write the RLS page standalone and include the transaction setup it needs, and note in your report that the two pages will need reconciling.

### Conventions

- `docs/*.md` are internal specs and contracts; `apps/docs-site/src/content/docs/**` is hand-authored Starlight MDX for users. They do **not** mirror each other — both need editing.
- Admonitions in the docs site use `:::` syntax; check the exact variants in use with `grep -rn ":::" apps/docs-site/src/content/docs/guides/ | head`.
- `pnpm docs:build` validates internal links and must pass.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Docs build | `pnpm docs:build` | exit 0 |
| Docs dev server | `pnpm docs:dev` | serves locally for visual check |
| Full gate | `pnpm build && pnpm lint && pnpm test && pnpm docs:build` | exit 0 |

## Scope

**In scope**:
- `docs/integration/tenant-enforcement.md` (create) — the recipe
- `apps/docs-site/src/content/docs/guides/multi-tenancy.mdx` — a trust-model section plus links
- `docs/specs/multi-tenancy.md` — invert the RLS framing at line 42
- `docs/contracts/tenant-policy.md` — align any guarantee language
- `apps/docs-site/src/content/docs/guides/run-safely-in-prod.mdx` — link the new page
- `apps/docs-site/src/content/docs/concepts/how-askdb-works.mdx` — only if its RLS reference contradicts the new framing
- `.changeset/document-tenant-enforcement.md` (create)

**Out of scope** (do NOT touch):
- Any code. This plan is documentation only. If writing it surfaces a code defect, record it in your report and leave the code alone.
- Generating RLS DDL, or adding an AskDB command that emits policies. That remains a stated non-goal; the page teaches the pattern, it does not automate it.
- Emitting `SET LOCAL` from `ask()`. That is a plausible future feature and explicitly not this plan — see the maintenance notes.
- Rewriting the guardrail's own docstring — plan 045 owns that.
- MySQL/SQLite/SQL Server equivalents beyond an honest capability note. See Step 3.

## Git workflow

- Branch: `advisor/049-document-database-tenant-enforcement`
- Commit style e.g. `docs: document database-level tenant enforcement`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Write the enforcement recipe page

Create `docs/integration/tenant-enforcement.md`. Read `docs/integration/postgres-partitioned-tables.md` first and match its structure and tone.

The page must cover, in this order:

1. **The trust model, stated plainly.** Three tiers and what each actually guarantees:
   - *Database enforcement (RLS)* — the database refuses to return other tenants' rows regardless of what SQL arrives. Cannot be bypassed by a generated query.
   - *Host-applied predicates* — the application adds the tenant filter itself before execution. Sound, but only as good as the host's coverage.
   - *AskDB's policy prompt and guardrail lint* — improves the odds the model writes a correct query and catches obvious mistakes. **Not a boundary.** State explicitly that tier 3 alone is not sufficient for isolation between untrusted tenants.
2. **A complete, runnable PostgreSQL example.** A two-table schema with a tenant column, `ALTER TABLE … ENABLE ROW LEVEL SECURITY`, a `CREATE POLICY` using a session setting, and the application-side transaction that sets it. The transaction must be read-only and roll back — nothing is ever written:

   ```sql
   BEGIN;
   SET TRANSACTION READ ONLY;
   SET LOCAL app.tenant_ids = '...';
   -- run the AskDB-generated SQL here
   ROLLBACK;
   ```

   Use `SET LOCAL` and say why: it is scoped to the transaction, so a pooled connection cannot leak the setting into the next request. That footgun is the single most valuable sentence on the page.
3. **How the policy reads the setting.** Show the `USING` clause, and cover the multi-ID case — a state administrator with many county IDs — since a single-value example does not generalize to the hierarchical scoping AskDB supports. If `current_setting()` returns text that must be split, show it, and show the empty/unset case failing closed rather than matching everything.
4. **`FORCE ROW LEVEL SECURITY` and the table-owner exception.** RLS does not apply to the table owner by default. An application connecting as the owner gets no protection and no error. This is the most common way an RLS deployment is silently ineffective — give it its own short subsection.
5. **How this composes with AskDB.** The tenant policy still earns its place: it grounds the model so queries are correct and efficient, and the guardrail catches obvious errors early. RLS is what makes a mistake safe rather than catastrophic. Link to the multi-tenancy guide.
6. **Verifying it works.** A short procedure: set the session to tenant A, run a deliberately unfiltered `SELECT *`, confirm only A's rows come back. Tell the reader to run this against a real database before trusting the setup — an RLS policy that is enabled but not effective looks identical to one that works until someone tests it.

Every SQL statement on this page must be one you are confident is correct for PostgreSQL. Where you are not certain, say so in the text rather than guessing.

**Verify**: `pnpm docs:build` → exit 0.

### Step 2: Add the trust model to the user-facing guide

Insert a new section into `apps/docs-site/src/content/docs/guides/multi-tenancy.mdx` immediately after `## How it works` (line 10-15), titled something like `## What enforces isolation`.

Keep it to a few short paragraphs — the three tiers, and a clear statement that AskDB's policy and guardrail are grounding and linting rather than a boundary. Link to `docs/integration/tenant-enforcement.md` for the recipe.

Add an admonition (matching the file's existing `:::` usage) near the top of the guide so a reader skimming the page cannot miss it. Two or three sentences: AskDB's tenant checks are heuristic and do not parse SQL; production deployments serving mutually untrusted tenants should enforce isolation in the database.

Then re-read `## What gets rewritten` (line 184) and `## Without a policy` (line 203) and correct anything that overstates the guarantee.

**Verify**: `pnpm docs:build` → exit 0, and the new section renders correctly under `pnpm docs:dev`.

### Step 3: State the non-Postgres situation honestly

RLS is a PostgreSQL feature. AskDB supports MySQL, MariaDB, SQLite, and SQL Server as dialects, and readers on those engines need to know where they stand.

Add a short subsection to the recipe page. Research each engine's capability before writing, and where you cannot confirm from first-party documentation, say the capability is unverified rather than describing a mechanism you have not checked. What you can say with confidence in all cases: on engines without an equivalent, the host must apply the tenant predicate itself before execution, and AskDB's checks remain a lint.

Do not invent syntax. An incorrect security example in our documentation is worse than an acknowledged gap.

**Verify**: `pnpm docs:build` → exit 0.

### Step 4: Invert the framing in the spec, and align the contract

At `docs/specs/multi-tenancy.md:42`, rewrite the non-goals entry. Keep the actual non-goal — AskDB does not generate RLS DDL — and drop the "RLS is still recommended as a defense-in-depth layer" framing, replacing it with a pointer to the new page and the correct ordering: database enforcement is the recommended isolation mechanism; AskDB's predicates are grounding and defense in depth.

Read `docs/contracts/tenant-policy.md` and correct any language that presents the policy or `strict` enforcement mode as guaranteeing isolation.

Check `apps/docs-site/src/content/docs/concepts/how-askdb-works.mdx` — if its RLS reference now contradicts the new framing, align it; if it is merely a passing mention, leave it.

**Verify**: `grep -rn -i "\bRLS\b" docs apps/docs-site/src` → every remaining hit is consistent with the new framing; `pnpm docs:build` → exit 0.

### Step 5: Cross-link and write the changeset

Add a link to the new page from:
- `apps/docs-site/src/content/docs/guides/run-safely-in-prod.mdx` — production safety
- the `## Read next` section of `multi-tenancy.mdx` (line 223)
- `docs/integration/executing-generated-sql.md` if plan 038 has landed (or note the pending reconciliation if it has not)

Create `.changeset/document-tenant-enforcement.md`. This is a docs-only change; check whether the repo issues changesets for documentation by looking at existing entries (`ls .changeset/`). If it does, a **patch** for `@askdb/core` with a body describing the new guidance is appropriate. If docs-only changes are not changeset-tracked here, skip the file and say so in your report.

**Verify**: `pnpm build && pnpm lint && pnpm test && pnpm docs:build` → all exit 0.

## Test plan

Documentation has no unit tests, so verification is structural:

- `pnpm docs:build` passes, which validates internal links across the site.
- **Every SQL statement on the new page must be executed against a real PostgreSQL instance before the plan is done.** The repo ships a Postgres fixture: `pnpm pagila:up` starts one on `localhost:5433` (see the root `package.json` scripts; `pnpm pagila:down` stops it). Create a scratch schema there, apply the RLS policy from the page, run the Step 1 verification procedure, and confirm the isolation actually holds. Then tear it down. **Do not commit anything from this exercise** — it is a correctness check on the prose, not a fixture.
- Record in your report: which statements you executed, and the observed result of the isolation test.

An untested security recipe is the main risk this plan carries. Do not skip this.

## Done criteria

ALL must hold:

- [ ] `docs/integration/tenant-enforcement.md` exists and covers all six items from Step 1
- [ ] Every SQL statement on that page was executed against a real PostgreSQL instance, and the isolation verification from Step 1 item 6 was observed to pass — stated explicitly in your report
- [ ] The page covers `FORCE ROW LEVEL SECURITY` and the table-owner exception
- [ ] The page uses `SET LOCAL` (not `SET`) and explains why
- [ ] `apps/docs-site/src/content/docs/guides/multi-tenancy.mdx` has a trust-model section and a visible admonition
- [ ] `grep -n "still recommended as a defense-in-depth layer" docs/specs/multi-tenancy.md` returns no matches
- [ ] The new page is linked from `run-safely-in-prod.mdx` and from `multi-tenancy.mdx`'s Read next
- [ ] `pnpm docs:build` exits 0
- [ ] `git diff --name-only -- packages apps/studio/src apps/cli/src apps/http-api/src` is empty (no code changed)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- You cannot verify an SQL statement against a real PostgreSQL instance (the fixture will not start, Docker is unavailable). Report which statements are unverified rather than shipping unverified security examples.
- The isolation verification **fails** — an unfiltered `SELECT *` returns other tenants' rows despite the policy. Either the recipe is wrong or there is a subtlety worth documenting prominently. Investigate and report; do not adjust the test until it passes.
- Writing the page surfaces a code defect — for example that `ask()` provides no way to emit the `SET LOCAL` a host needs. Note it in your report as a follow-up. Do not fix code here.
- You find a docs claim that AskDB's tenant policy is sufficient for a compliance regime (SOC 2, HIPAA, or similar). That is a product-positioning question, not an editorial one. Report the exact wording.
- Plan 038 has landed and its `executing-generated-sql.md` already covers transaction setup in a way that conflicts with your Step 1 example. Reconcile toward 038's version and say so.

## Maintenance notes

- **The obvious follow-up is emitting the session setting from AskDB.** A host currently has to hand-write the `SET LOCAL` and keep its value in sync with the `tenantScope` it passed to `ask()`. `ask()` already resolves the tenant IDs — returning a ready-made session-setting statement alongside `tenantBindings` would remove a manual step and a class of mismatch bugs. Deliberately out of scope here (this plan is documentation), but it is the natural next increment and this page is where it would be documented.
- **Keep this page and the guardrail's docstring in agreement.** Plan 045 rewrites `validateTenantGuardrails`'s description to point here. If the trust model on this page ever changes, that docstring changes with it.
- **The verification procedure in Step 1 item 6 is the most valuable part of the page.** An RLS policy that is enabled but ineffective — usually because the app connects as the table owner — is indistinguishable from a working one without running the test. Do not let it get trimmed for length in review.
- **Reviewer focus**: confirm the executor actually ran the SQL rather than reasoning about it, and check the `SET` vs `SET LOCAL` distinction is correct everywhere it appears.
