# Plan 050: Design spike — deterministic tenant predicate rewriting

> **Executor instructions**: This is a **design spike**, not an implementation. Its deliverable is a written specification with a recommendation, not working code. Do not modify anything under `packages/` or `apps/`. Follow the steps, run every verification command, and if anything in the "STOP conditions" section occurs, stop and report. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 595182d..HEAD -- packages/core/src/sql` If any file in that directory changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, note the drift in the spec rather than treating it as a blocker — a spike reads code rather than depending on it being frozen.

## Status

- **Priority**: P2
- **Effort**: M (research and writing; no implementation)
- **Risk**: LOW — produces a document. The *decisions* it recommends are high-risk, which is exactly why they get written down and reviewed before anyone writes code.
- **Depends on**: plan 045 (soft) — 045 establishes the honest baseline description of what the guardrail does and does not do. This spike proposes what would replace it.
- **Category**: direction
- **Planned at**: commit `595182d`, 2026-08-05
- **Breaking**: No — no code changes.

## Why this matters

AskDB's tenant isolation currently works by describing a policy to the model, asking it to write compliant SQL, and checking the result with identifier-presence heuristics. Two of those three steps depend on the model cooperating, and the verifier does not parse SQL — it cannot distinguish a `SELECT` list from a `WHERE` clause, cannot see `OR 1=1`, and cannot see negation.

Plan 049 documents the sound answer for teams who can use it: enforce in the database with row-level security. But not every deployment can. AskDB supports five other dialects, some teams cannot alter their database, and some connect as the table owner where RLS does not apply.

For those cases the sound in-library answer is to stop asking the model for the tenant predicate and apply it deterministically instead — rewrite each scoped base-table reference so the predicate is attached by AskDB, whatever the model wrote. This is what Hasura and PostGraphile do, and it is the difference between verifying a model's output and not depending on it.

Until PR #168 that was blocked on not having a SQL lexer. #168 merged one. The question is now genuinely open, and it is large enough that the design should be argued on paper before anyone commits to an implementation.

## Current state

### What the guardrail does today — `packages/core/src/sql/tenant-guardrail.ts:181-197`

```ts
function normalizeSql(sql: string): string {
  return sql.toLowerCase();
}

function mentionsTable(normalizedSql: string, tableName: string): boolean {
  const pattern = new RegExp(`\\b${escapeRegex(tableName.toLowerCase())}\\b`);
  return pattern.test(normalizedSql);
}

function mentionsIdentifier(normalizedSql: string, identifier: string): boolean {
  const pattern = new RegExp(`\\b${escapeRegex(identifier.toLowerCase())}\\b`);
  return pattern.test(normalizedSql);
}
```

Queries that pass this check while providing no isolation at all:

- `SELECT agency_id FROM orders` — the tenant column is selected, never filtered
- `SELECT * FROM orders WHERE agency_id IN (:tenant_agency_ids) OR 1=1`
- `SELECT * FROM orders WHERE agency_id NOT IN (:tenant_agency_ids)`
- any query where the predicate sits in a subquery that does not constrain the outer result

(If plan 045 has landed, the string-literal false positive is fixed and the docstring is honest; these four remain.)

### What #168 made available — `packages/core/src/sql/bind.ts`

```ts
export type SqlSpanKind = "code" | "quoted";
```
```ts
/**
 * Tokenize SQL into contiguous code vs quoted regions.
 * Recognizes single-quoted strings (doubled-quote escapes), double-quoted
 * identifiers, PostgreSQL dollar-quoting, MySQL backticks, and SQL Server brackets.
 */
export function tokenizeSqlSpans(sql: string): SqlSpan[] {
```

Also in that file: `stripSqlStringLiterals` (line 180), `scanPlaceholders` (line 267), `isValidListContext` (line 297), `markerStyleForDialect` (line 406), `formatMarker` (line 420), `bindPreparedQuery` (line 531), and `sqlStructurallyEqual` (line 716).

This is a lexer, not a parser. It answers "is this offset inside a string literal?" It does not produce a syntax tree, does not identify clause boundaries, and does not resolve table aliases. Any rewriting design must be explicit about that gap.

### The parameter manifest and its `source` field — `packages/core/src/sql/bind.ts:33`

```ts
  source: "question" | "tenant";
```

Every bound parameter records whether it came from the user's question or from the tenant scope. This enables a *structural* check — "does this query declare and bind a tenant parameter for every scoped table it references?" — which is stronger than a textual one, though still a check on the model's output rather than enforcement.

### The policy model the rewriter would consume — `packages/core/src/schema/v2/tenant-policy.ts:42-52`

```ts
export const scopedTableSchema = z.strictObject({
  id: z.string().min(1),
  scopeThrough: z.array(scopeThroughSchema).min(1),
});

export const polymorphicTableSchema = z.strictObject({
  id: z.string().min(1),
  typeColumn: z.string().min(1),
  idColumn: z.string().min(1),
  mapping: z.record(z.string(), z.string().min(1)),
});
```

`scopeThrough` is a union of `{ root, column }` (direct tenant column) and `{ root, join: [{from, to}, …] }` (reached by joining). The join variant is the hard case for any rewriting design and must not be hand-waved.

### Related plans this spike must account for

- **045** — reclassifies the guardrail as a lint and hardens it onto the lexer. This spike proposes what would supersede or complement it.
- **047** — implements `subtree` descendant expansion. Any rewriting design must handle subtree scopes.
- **049** — documents RLS as the primary enforcement path. This spike is the answer for deployments that cannot use it; the spec must be explicit about how the two relate.

Check each plan's status in `plans/README.md` before writing, and read any that have landed.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Read the lexer | `sed -n '60,260p' packages/core/src/sql/bind.ts` | prints the tokenizer |
| Existing tenant tests | `pnpm --filter @askdb/core exec vitest run --config ../../vitest.config.ts src/sql/tenant-guardrail.test.ts` | all pass (baseline) |
| Docs build | `pnpm docs:build` | exit 0 |

## Scope

**In scope**:
- `docs/specs/tenant-rewriting/README.md` (create) — the spec
- `docs/specs/tenant-rewriting/prior-art.md` (create) — how others solve this
- `plans/README.md` — status row

**Out of scope** (do NOT touch):
- **Every file under `packages/` and `apps/`.** This spike produces a document. If you find yourself editing source, you have misread the assignment.
- Adding a SQL-parser dependency to any manifest. Evaluating candidates is in scope; installing one is not.
- Prototyping in the repo. If you want to try something, do it in a scratch directory outside the repository and report the findings.
- Re-deciding whether RLS is the primary recommendation. Plan 049 settles that; this spike covers deployments that cannot use it.

## Git workflow

- Branch: `advisor/050-spike-deterministic-tenant-rewriting`
- Commit style e.g. `docs(specs): design spike for deterministic tenant rewriting`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Survey the prior art

Write `docs/specs/tenant-rewriting/prior-art.md`. Cover how comparable systems apply mandatory row filters:

- **PostgreSQL row-level security** — enforcement in the planner. What it guarantees, and the two ways it silently fails (table owner without `FORCE`, unset session variable matching everything).
- **Hasura / PostGraphile** — compile permissions into the generated query. What layer they operate at, and why they can do it soundly (they *generate* the SQL rather than receiving it).
- **Oracle VPD / SQL Server RLS predicate functions** — the same idea in other engines.
- **Query-rewriting middlewares** — anything that takes arbitrary SQL and injects predicates. Note what they require: a real parser, and usually a restricted SQL subset.

For each, record what it requires and what it guarantees. The pattern worth surfacing explicitly: systems that *generate* queries can enforce soundly and cheaply; systems that *receive* arbitrary queries need a parser and still struggle with correlated subqueries and aliasing. AskDB receives.

**Verify**: the document exists and covers at least four systems, each with a "requires" and "guarantees" line.

### Step 2: Specify the rewriting approach

Write the core of `docs/specs/tenant-rewriting/README.md`. Specify the transformation precisely enough that a reader could argue with it.

The candidate: rewrite each scoped base-table reference into a bounded inline view.

```sql
FROM orders  →  FROM (SELECT * FROM orders WHERE agency_id IN ($1,$2)) AS orders
```

Work through, with a concrete SQL example for each:

1. **Simple case** — a scoped table with a direct `{ root, column }` path in the `FROM` clause.
2. **Aliases** — `FROM orders o`. The alias must be preserved or every reference to `o.` breaks.
3. **Joins** — a scoped table appearing in `JOIN … ON`.
4. **The `{ root, join: [...] }` scope path** — a table with no tenant column, reachable only by joining to the root. An inline view cannot express this without adding the join itself. Does the rewriter inject a join, use an `EXISTS` subquery, or refuse? This is the hard case; do not skip it.
5. **Subqueries and CTEs** — a scoped table referenced inside a `WITH` clause or a nested `SELECT`.
6. **Polymorphic tables** — `typeColumn`/`idColumn`/`mapping` from the policy. Can the predicate be expressed as a filter at all?
7. **Self-joins** — the same table twice with different aliases, each needing its own bounded view.
8. **Set operations** — `UNION`, `INTERSECT` across scoped tables.

For each: state whether the approach handles it, how, and what happens when it cannot.

**The refusal path is the most important section of this document.** A rewriter that cannot prove it covered every reference must refuse the query, not pass it through. Specify what "cannot prove" means concretely and what the caller receives.

**Verify**: the document has a subsection per case above, each with example SQL and a stated outcome.

### Step 3: Answer the parser question

A lexer is not enough for Step 2 — identifying `FROM` and `JOIN` clauses, resolving aliases, and understanding subquery nesting all need structure. Evaluate the options and recommend one:

- **Extend `bind.ts` with a minimal `FROM`/`JOIN` clause scanner.** Smallest dependency footprint; only viable if the supported SQL shape is narrow enough. AskDB already restricts output to single-statement `SELECT`/`WITH` (see `packages/core/src/sql/validate.ts`), which narrows it considerably — quantify how much.
- **Adopt a SQL parser dependency** (`node-sql-parser` or similar). Evaluate: dialect coverage across all six `DialectId` values, maintenance health, bundle size, and — critically — what it does with SQL it cannot parse. A parser that silently returns a partial tree is a security hazard in this position.
- **Restrict the supported subset.** Rewrite only queries whose shape the implementation can fully verify, and refuse anything else. Smallest risk, real usability cost. Estimate what fraction of realistic model output would be refused — sample the existing test fixtures in `packages/core/src/sql/*.test.ts` for realistic shapes.

Recommend one with reasoning. State the cost of being wrong for each.

**Verify**: the document names a recommended option and gives a decision rationale, not a survey.

### Step 4: Specify the manifest-based structural check

Independent of full rewriting, and much cheaper: use the `source: "tenant"` field on parameter manifest entries to assert that every scoped table referenced by the query has a corresponding bound tenant parameter.

Specify it: what it checks, what it catches that today's guardrail misses, and — explicitly — what it still misses. It verifies that a tenant parameter was *declared and bound*, not that it constrains the result, so `OR 1=1` still defeats it.

This is worth specifying separately because it is a plausible incremental step that could ship well before rewriting, and the spec should say whether it is worth doing on its own or whether it creates a false sense of progress.

**Verify**: the document has a section on this with an explicit "what this still does not catch" list.

### Step 5: Recommend, sequence, and size

Close the spec with a recommendation the maintainer can act on:

- **Recommended direction**, and what to do first.
- **Sequencing** relative to plans 045 (lint hardening), 047 (subtree), and 049 (RLS docs). Say plainly whether rewriting supersedes the guardrail or complements it.
- **Effort estimate** in S/M/L for each increment, with the reasoning behind the sizing.
- **A "do not build this" case.** Argue the other side honestly: if RLS covers the deployments that matter and rewriting is a large, permanently-maintained surface with sharp edges, the right answer may be to invest in documentation and refusal instead. A spike that only argues for building is not a spike.
- **Open questions** for the maintainer, each with a recommended answer.

**Verify**: `pnpm docs:build` → exit 0 (if the specs directory is included in the docs build; if not, confirm the markdown is well-formed and say so).

## Test plan

A spike has no tests. Verification is that the document answers the questions it set out to answer:

- Every case in Step 2 has example SQL and a stated outcome — including the ones where the answer is "refuse."
- Step 3 reaches a recommendation rather than listing options.
- Step 5 includes a genuine argument against building it.
- No file under `packages/` or `apps/` was modified.

Before finishing, re-read the document as if you were the maintainer deciding whether to fund the work. If it does not give you enough to decide, it is not done.

## Done criteria

ALL must hold:

- [ ] `docs/specs/tenant-rewriting/README.md` and `docs/specs/tenant-rewriting/prior-art.md` exist
- [ ] `prior-art.md` covers at least four systems with "requires" and "guarantees" for each
- [ ] `README.md` has a subsection for each of the eight cases in Step 2, each with example SQL
- [ ] `README.md` specifies the refusal path concretely
- [ ] `README.md` recommends one parser option with rationale
- [ ] `README.md` has a manifest-check section including "what this still does not catch"
- [ ] `README.md` contains an explicit argument against building it
- [ ] `git diff --name-only -- packages apps` is **empty**
- [ ] `git status` shows changes only under `docs/specs/tenant-rewriting/` and `plans/README.md`
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- You conclude no available approach can soundly rewrite arbitrary model-generated SQL for all six dialects. That is a legitimate and valuable finding — write it up as the spec's conclusion rather than forcing a design.
- You find yourself writing implementation code in `packages/`. Stop; this is a spike.
- Evaluating a parser dependency requires installing it. Do that in a scratch directory outside the repository, or evaluate from documentation and published metadata. Do not add it to any manifest.
- The join-based `scopeThrough` variant (Step 2 case 4) turns out to have no tractable rewriting. Say so prominently — it would mean rewriting can only cover direct-column scoping, which is a significant limitation and changes the recommendation.
- Plans 045, 047, or 049 have landed and materially change the baseline you are designing against. Read them and account for them; note in the spec which state you designed against.

## Maintenance notes

- **This spike's output should gate the work, not become it.** If the recommendation is to build, the follow-up should be its own plan (or several), written against the spec.
- **The `sqlStructurallyEqual` helper in `bind.ts:716` may be relevant** to a rewriting design — comparing SQL modulo literal values is exactly the primitive needed to assert a rewrite preserved query shape. Worth evaluating in Step 2.
- **Keep the spec honest about the lexer/parser distinction.** #168 shipped a lexer. Repeated informally, "we have a SQL parser now" would justify decisions the code does not support. The spec is the right place to nail that down.
- **Reviewer focus**: whether the refusal path is specified concretely enough to implement, and whether the "do not build this" section is a real argument or a formality.
