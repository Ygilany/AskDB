# Plan 026: Show the `@askdb/client` fast path in the example

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat d7faa20..HEAD -- examples/ask-question/main.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpt against the live code before proceeding; on a mismatch, treat it as a
> STOP condition. Also confirm `@askdb/client` exists
> (`ls packages/client/src/client.ts`) — this plan depends on plan 024.

## Status

- **Priority**: P3
- **Effort**: S
- **Depends on**: plans/024-askdb-client-facade.md (hard). Independent of 025.
- **Category**: docs / dx
- **Planned at**: commit `d7faa20`, 2026-06-15

## Why this matters

The canonical "how do I use AskDB in my code" example,
`examples/ask-question/main.ts`, currently demonstrates the hand-wired path:
`loadSchema(dir)` + `ai.createLanguageModelFromEnv(...)` + `ask({ question,
schema, model, dialect })`. Now that `@askdb/client` exists (plan 024), the
example should lead with the facade fast path — `createAskDb(...).ask("question")`
— so new readers see the smallest possible call first, then keep the explicit
path as the "advanced / BYO" variant. This is the user-facing payoff of the whole
architecture change.

## Current state

`examples/ask-question/main.ts` (read the whole file, ~150 lines). Today it:

```ts
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
import { createAiRegistry } from "@askdb/ai";
import { openaiProvider } from "@askdb/ai-openai";
import { ask, loadSchema } from "@askdb/core";
// ...
const ai = createAiRegistry([openaiProvider]);
bootstrapAskDbEnv({ cwd: __dirname });
const runtimeConfig = getAskDbRuntimeConfig();
const schema = loadSchema(SCHEMA_DIR);
const model = await ai.createLanguageModelFromEnv(runtimeConfig.ai.aiEnv);
// ...
const result = await ask({ question, schema, model, dialect: "postgres" });
```

The example has two sections today: "Path A — basic" and "Path B — with RAG".
The RAG section passes `retriever` / `totalSchemaChunkCount` /
`retrievalThresholdChunks` to `ask()`.

`examples/ask-question/package.json` lists its workspace deps. Confirm whether
`@askdb/client` needs adding (`cat examples/ask-question/package.json`).

## Commands you will need

| Purpose          | Command                                          | Expected     |
|------------------|--------------------------------------------------|--------------|
| Install          | `pnpm install`                                   | exit 0       |
| Typecheck example| `pnpm --filter <example-pkg-name> lint` *or* `pnpm exec tsc --noEmit -p examples/ask-question` | exit 0 |
| Build client     | `pnpm --filter @askdb/client build`              | exit 0       |

Find the example's package name with
`node -p "require('./examples/ask-question/package.json').name"` and whether it
has a `lint`/typecheck script (`node -p "Object.keys(require('./examples/ask-question/package.json').scripts||{})"`).
If it has no typecheck script, use the repo's base config:
`pnpm exec tsc --noEmit --moduleResolution nodenext --module nodenext examples/ask-question/main.ts`
(adjust flags until it typechecks against the workspace packages). If you cannot
get a clean typecheck command, STOP and report rather than shipping unverified.

## Scope

**In scope**:
- `examples/ask-question/main.ts`
- `examples/ask-question/package.json` (only if `@askdb/client` must be added)
- `examples/ask-question/README.md` (if one exists — update prose to mention the fast path)

**Out of scope**:
- `packages/client/**` and any host (`apps/**`) — not this plan.
- `apps/docs-site/**` — the docs site is large and hand-authored; a docs-site
  pass is a separate plan if the maintainer wants it. Do not edit it here.
- The RAG section's behavior — keep it working; only restructure how the model/
  schema are obtained if it simplifies, otherwise leave as-is.

## Git workflow

- Branch: `advisor/026-client-facade-example`
- One commit: `docs(example): lead ask-question with the @askdb/client fast path`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add the dependency if needed

If `examples/ask-question/package.json` does not list `@askdb/client`, add
`"@askdb/client": "workspace:*"` to its `dependencies` and run `pnpm install`.

**Verify**: `pnpm install` → exit 0.

### Step 2: Restructure `main.ts` to lead with the facade

Add a new first section that uses the facade, before the existing "Path A":

```ts
import { createAskDb } from "@askdb/client";
// ...existing imports stay (createAiRegistry, openaiProvider, ask, loadSchema)...

// ── Fast path — createAskDb resolves schema, model, and dialect from config ──
//
// Schema comes from host.schemaPath in askdb.config.ts (or pass it here);
// the model comes from the AI registry; the dialect is inferred. You only
// pass the question.
const askdb = createAskDb({
  config: runtimeConfig,
  registry: ai,
  schema: { path: SCHEMA_DIR },   // or set host.schemaPath in askdb.config.ts and omit this
});

for (const question of QUESTIONS) {
  const { sql } = await askdb.ask(question);
  console.log(`  SQL: ${sql}`);
}
```

Then keep the existing explicit `ask({ question, schema, model, dialect })`
section, retitled to make clear it is the **advanced / direct** path (BYO model,
full control), with a one-line comment pointing readers to the fast path above
for the common case. Keep the RAG section (Path B) — it can either keep calling
`ask(...)` directly (clearest, since it shows retriever wiring) or use
`askdb.ask(question, { retriever, totalSchemaChunkCount, retrievalThresholdChunks })`;
prefer whichever keeps the example readable. The `model`/`schema`/`embeddingModel`
setup the RAG path needs stays.

Keep the existing "no API key configured" guard behavior — with the facade, a
missing key surfaces as a thrown error from `askdb.ask`; ensure the example still
exits cleanly with a helpful message (wrap the fast-path loop in try/catch or
keep the explicit pre-check that already exists).

**Verify**: the typecheck command from "Commands you will need" → exit 0.

### Step 3: Update example prose

If `examples/ask-question/README.md` exists, add a sentence near the top that the
example shows two ways to call AskDB: the `@askdb/client` fast path (only the
question) and the direct `@askdb/core` `ask()` path (BYO model / full control).

**Verify**: no build step needed; `git diff --stat examples/ask-question` shows
only in-scope files.

## Test plan

- This is an example, not a tested package. Verification is: it typechecks
  against the workspace, and the imports resolve.
- Do NOT run the example end-to-end (it needs a real API key). If `dev.mockSql`
  is set in the example's `askdb.config.ts`, a `node`/`tsx` run would work
  offline — optional, only if trivially available.

## Done criteria

ALL must hold:

- [ ] The example typechecks (the chosen typecheck command exits 0)
- [ ] `grep -n "createAskDb" examples/ask-question/main.ts` returns a match
- [ ] The explicit `ask({ ... })` direct path is still present (not deleted) — `grep -n "ask({" examples/ask-question/main.ts` returns a match
- [ ] `pnpm install` exits 0 (if package.json changed)
- [ ] `git status` shows changes only under `examples/ask-question/`
- [ ] `plans/README.md` status row for 026 updated

## STOP conditions

Stop and report back (do not improvise) if:

- You cannot produce a reliable typecheck command for the example (don't ship
  unverified TypeScript).
- `@askdb/client`'s exported API differs from what plan 024 specified
  (`createAskDb`, `askdb.ask(question, overrides)`).
- The drift check shows `main.ts` already restructured around the facade.

## Maintenance notes

- Keep both paths in the example on purpose: the fast path is the headline, the
  direct path documents the BYO-model escape hatch that `@askdb/core` guarantees.
- If a docs-site page later mirrors this example, reuse the same two-path framing
  ("fast path" vs "direct/BYO") for consistency with the `bring-your-own-model`
  guide.
- A dedicated `apps/docs-site` update for `createAskDb` is intentionally deferred
  to its own plan — flag it to the maintainer if they want the docs site to lead
  with the facade too.
