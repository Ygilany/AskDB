# Plan 018: Explain how the artifact (physical schema + enrichment) is repackaged into a model-facing format

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 4b80530..HEAD -- apps/docs-site/src/content/docs/concepts/the-schema-artifact.mdx apps/docs-site/src/content/docs/guides/author-your-schema.mdx packages/core/src/schema/v2/format.ts`
> If any in-scope doc changed since this plan was written, compare the "Current
> state" excerpts against the live files; on a mismatch, treat it as a STOP
> condition. (The `format.ts` path is included so you can confirm the mechanism
> still matches before describing it — see Step 0.)

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `4b80530`, 2026-06-14

## Why this matters

Both schema-facing pages describe the artifact's **on-disk** form (a directory
of `schema.json` + markdown), but neither says what the model actually receives.
A reader is left assuming AskDB ships the raw JSON or the raw markdown to the
model. It doesn't: at generation time AskDB **repackages** the physical schema
and the enrichment together into a compact, model-friendly text format — a
DDL-style block with the enrichment folded in as inline comments. Saying this
explicitly does two things: it demystifies "what the model sees" (reinforcing
the privacy story — only schema + enrichment text, never rows), and it explains
*why* enrichment shaped as descriptions/aliases/CQL is effective (it becomes
annotations the model reads alongside each table).

## Current state — verified mechanism (Step 0, read before writing)

Before editing, confirm the mechanism so your wording is accurate:

- `packages/core/src/schema/v2/format.ts` — `formatSchemaV2ForNlToSql(schema)`
  returns `{ ddl, stats }`. Its doc comment: *"Format a NormalizedSchemaV2 for
  NL→SQL prompts. Interleaves table descriptions, aliases, column descriptions,
  and `Common query language` blocks…"*. It emits lines like `TABLE
  schema.name -- aliases: …`, a `-- <description>` comment line, column
  definitions, and sensitive fields tagged `(sensitive)` or withheld.
- `packages/core/src/retrieval/synthesize-ddl.ts` — for large/RAG schemas the
  retrieved slice is rendered the same way (`synthesizeRetrievedDdl`): TABLE
  blocks with inline `-- aliases / values / desc` annotations and a
  `-- common query language --` block.

So the accurate claim is: **the artifact's physical structure and enrichment are
merged and serialized into a DDL-style text (table blocks with the enrichment as
inline comments); that text — not the JSON or the markdown files — is what goes
into the model prompt.** Do **not** claim a specific exact byte format beyond
"DDL-style text with enrichment as inline comments" (the exact layout is an
implementation detail and may evolve). Do **not** name internal function names
in the user-facing docs.

**Verify Step 0**: open `packages/core/src/schema/v2/format.ts` and confirm the
doc comment and the `TABLE` / `-- aliases:` / `(sensitive)` line shapes still
match the description above. If they don't, STOP.

## Current state — the two pages

- `apps/docs-site/src/content/docs/concepts/the-schema-artifact.mdx` — has
  `## The physical layer` (lines 33–58) and `## The enrichment layer` (lines
  60–86), then `## Stable IDs`, then `## Why this matters`. There is currently
  **no** section describing how the two layers become the prompt.

- `apps/docs-site/src/content/docs/guides/author-your-schema.mdx` — lead
  paragraph (lines 7–8) explains enrichment "gives it real meaning and
  context." There is no statement that enrichment is repackaged for the model.

- **Convention**: prose sections use `## Heading` then paragraphs; inline code
  with backticks. `<Aside>` callouts are used elsewhere but neither of these two
  files imports Starlight components, so **prefer a plain prose section** (no new
  imports) to keep the change minimal.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `cd apps/docs-site && pnpm lint` | exit 0, `0 errors` |
| Build + link check | `cd apps/docs-site && pnpm test` | exit 0 |

## Scope

**In scope**:
- `apps/docs-site/src/content/docs/concepts/the-schema-artifact.mdx`
- `apps/docs-site/src/content/docs/guides/author-your-schema.mdx`

**Out of scope** (do NOT touch):
- `packages/core/**` — source is read-only here; you only confirm the mechanism.
- `concepts/privacy-model.mdx` — it covers "what the model sees" from the
  privacy angle; do not duplicate this packaging explanation there.

## Git workflow

- Branch: `advisor/018-prompt-packaging-explanation`
- Commit style: conventional, e.g. `docs: explain how the artifact is repackaged for the model`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add a "What the model actually receives" section to the schema-artifact concept page

In `the-schema-artifact.mdx`, insert a new `##` section **after** the
`## The enrichment layer` section (i.e. after its last line, before
`## Stable IDs`):

```mdx
## What the model actually receives

The model never sees the directory you author. At generation time AskDB merges the physical layer and the enrichment into a single compact, model-facing text — a DDL-style description where each table is rendered as a block and your enrichment is folded in as inline comments (descriptions, aliases, and "common query language" attached to the table and columns they describe). Sensitive fields are tagged or withheld here according to your mode.

So the two layers you maintain separately on disk — `schema.json` for structure, markdown for meaning — are assembled into one annotated schema description the model reads. That repackaged text, plus the question, is the entire prompt: never your rows, your credentials, or your query results. When a schema is too large to send whole, the same rendering is applied to only the relevant slice retrieved for the question (see [RAG for large schemas](/guides/rag-for-large-schemas/)).
```

**Verify**: `grep -c "What the model actually receives" apps/docs-site/src/content/docs/concepts/the-schema-artifact.mdx` → `1`. Then
`cd apps/docs-site && pnpm lint` → exit 0.

### Step 2: Add the same point (shorter) to the Author-your-schema guide

In `author-your-schema.mdx`, add a short `##` section **before** `## Read next`
(after the `## Commit it` section):

```mdx
## How enrichment reaches the model

Your enrichment doesn't get sent to the model as the markdown you write. When you ask a question, AskDB merges the physical schema and your enrichment into one compact, model-facing schema description — a DDL-style block where descriptions, aliases, and "common query language" become inline annotations on the tables and columns they belong to. That's why enrichment written as plain-language descriptions and the phrases your users actually say is effective: it lands right next to the structure the model is reasoning over. See [The schema artifact](/concepts/the-schema-artifact/) for the full picture of what the model receives.
```

**Verify**: `grep -c "How enrichment reaches the model" apps/docs-site/src/content/docs/guides/author-your-schema.mdx` → `1`. Then
`cd apps/docs-site && pnpm lint` → exit 0.

## Test plan

Docs change — no unit tests. Gate is the build + link check:

- `cd apps/docs-site && pnpm test` → exit 0 (both new internal links —
  `/guides/rag-for-large-schemas/` and `/concepts/the-schema-artifact/` — resolve;
  the link checker confirms it).

## Done criteria

ALL must hold:

- [ ] `the-schema-artifact.mdx` has a "What the model actually receives" section
      between the enrichment-layer and stable-IDs sections
- [ ] `author-your-schema.mdx` has a "How enrichment reaches the model" section
      before "Read next"
- [ ] Neither new section names internal symbols (`grep -c "formatSchemaV2ForNlToSql\|synthesizeRetrievedDdl" <both files>` → `0`)
- [ ] `cd apps/docs-site && pnpm lint` exits 0; `pnpm test` exits 0
- [ ] Only the two in-scope files are modified (`git status`)
- [ ] `plans/README.md` status row for 018 updated

## STOP conditions

Stop and report (do not improvise) if:

- The Step 0 verification fails — `format.ts` no longer renders a DDL-style
  format with enrichment as inline comments. The wording in this plan would then
  be wrong; report what the format actually is now.
- The "Current state" doc excerpts don't match the live files (drift since `4b80530`).

## Maintenance notes

- This wording is deliberately format-agnostic ("DDL-style text with enrichment
  as inline comments") so it survives changes to the exact prompt layout in
  `packages/core/src/schema/v2/format.ts`. If the rendering ever changes shape
  substantially (e.g. to real `CREATE TABLE` statements, or to JSON), revisit
  both sections.
- A reviewer should check this doesn't contradict `concepts/privacy-model.mdx` —
  both must agree that only schema + enrichment text + the question reach the
  model.
