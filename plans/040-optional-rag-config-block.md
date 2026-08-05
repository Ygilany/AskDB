# Plan 040: Make the `rag` block optional in `AskDbConfig`

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat cc1193a..HEAD -- packages/config/src/types.ts packages/config/src/flatten.ts packages/config/src/defaults.ts` If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `cc1193a`, 2026-08-05
- **Breaking**: No — this widens what `AskDbConfig` accepts. Every existing config remains valid.

## Why this matters

`AskDbConfig` requires a `rag` block with four required sub-fields. Retrieval is an optional feature that most first-time integrations do not use, so those users are made to write configuration for a subsystem they have not enabled.

A real consumer's `askdb.config.ts` carries exactly this filler:

```ts
  rag: {
    embedder: `mock`,
    embedderConfig: {},
    store: `file`,
    storeConfig: {
      file: {},
    },
  },
```

Four keys and eight lines that mean "I am not using RAG." Required configuration for unused features is a small tax paid by every single new integration, and it makes the config file read as though RAG were a core concept rather than an opt-in layer.

## Current state

### The type

`packages/config/src/types.ts:327-353`:

```ts
export type AskDbConfig = {
  ai: AskDbAiConfig;

  introspection: AskDbIntrospectionConfig;

  dialect?: AskDbDialectId;

  rag: {
    embedder: AskDbRagEmbedder;
    embedderConfig: {
      openai?: OpenaiRagEmbedderConfig;
    };
    store: AskDbRagStore;
    storeConfig: {
      file?: FileStoreConfig;
      memory?: MemoryStoreConfig;
      pgvector?: PgvectorStoreConfig;
    };
  };

  logging?: { ... };
  modes?: { ... };
  host?: { schemaPath?: string; schemaJson?: string };
  dev?: { mockSql?: string };
```

Note that `logging`, `modes`, `host`, `dev`, and `dialect` are already optional — `rag` is the outlier. `ai` and `introspection` stay required and are out of scope.

### The single consumer

`config.rag` is dereferenced in exactly one place. Confirm with `grep -rn "config\.rag" packages/config/src` → one hit.

`packages/config/src/flatten.ts:187-196`:

```ts
  // --- RAG ---
  const rag = config.rag;
  if (!isMember(rag.embedder, ASKDB_RAG_EMBEDDERS)) {
    throw new Error(
      `askdb.config: invalid rag.embedder "${rag.embedder}" (expected one of: ${ASKDB_RAG_EMBEDDERS.join(", ")}).`,
    );
  }
  set(out, "ASKDB_RAG_EMBEDDER", rag.embedder);
```

followed by embedder handling (lines 198-208), store validation (210-214), and per-store branches for `file`, `memory`, and `pgvector` (215-238).

There is a second, unrelated use of the same shape at `packages/config/src/flatten.ts:114-125` — `resolveRagEmbeddingDimensions(rag)`, which takes `AskDbConfig["rag"]` as a parameter rather than reading `config.rag`. Its signature will need the same optionality treatment.

### The defaults that already exist

`packages/config/src/defaults.ts` holds `DEFAULT_RAG_EMBEDDING_MODEL`, `DEFAULT_RAG_FILE_BASE_PATH`, and `DEFAULT_MOCK_RAG_EMBEDDING_DIMENSIONS`. Read that file before Step 2 — the defaults for the omitted case should come from there, not be re-declared inline.

### Convention to match

- Optional blocks in this file are declared with `?:` and their sub-fields documented with JSDoc — see `logging` at lines 355-362.
- `flattenAskDbConfig` validates and throws `Error` with messages prefixed `askdb.config:` — match that phrasing exactly.
- Tests are in `packages/config/src/flatten.test.ts` (confirm the filename with `ls packages/config/src/*.test.ts`). Follow its structure.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm --filter @askdb/config lint` | exit 0 |
| Tests | `pnpm --filter @askdb/config test` | all pass |
| Full gate | `pnpm build && pnpm lint && pnpm test` | exit 0 |
| Docs build | `pnpm docs:build` | exit 0 |

## Scope

**In scope**:
- `packages/config/src/types.ts` — make `rag` optional
- `packages/config/src/flatten.ts` — handle the omitted case
- `packages/config/src/flatten.test.ts` — new cases
- `apps/cli/src/init.ts` — stop emitting a `rag` block when the user did not choose a RAG store (see Step 4; verify the condition first)
- `apps/docs-site/src/content/docs/reference/config.mdx` — mark `rag` optional
- `.changeset/optional-rag-config.md` (create)

**Out of scope** (do NOT touch):
- Making `ai` or `introspection` optional. Both are genuinely required — AskDB cannot resolve a model or locate a schema without them.
- The `rag` block's internal shape. When present it keeps exactly today's required sub-fields; only the block itself becomes omittable. Making `embedderConfig`/`storeConfig` optional too is a separate change with its own default-resolution questions.
- `packages/rag/**`. This is a configuration-typing change; the RAG package reads flattened env keys and is unaffected.
- The `ASKDB_RAG_*` env key names or their values when `rag` *is* present. Existing deployments depend on them.

## Git workflow

- Branch: `advisor/040-optional-rag-config-block`
- Commit message style e.g. `feat(config): make the rag block optional`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Make `rag` optional in the type

In `packages/config/src/types.ts`, change `rag:` to `rag?:` and add JSDoc explaining the omitted behavior:

```ts
  /**
   * Retrieval (RAG) settings. Omit this block entirely when you are not using
   * retrieval — AskDB then behaves as if `embedder: "mock"` and `store: "memory"`
   * were set, and emits no `ASKDB_RAG_*` keys beyond the embedder marker.
   */
  rag?: {
    embedder: AskDbRagEmbedder;
    ...
  };
```

Keep the inner fields required — when the block is present it must be complete.

**Verify**: `pnpm --filter @askdb/config lint` → expect **failures** in `flatten.ts` where `config.rag` is now possibly `undefined`. That is the expected intermediate state; Step 2 fixes it.

### Step 2: Handle the omitted block in `flattenAskDbConfig`

In `packages/config/src/flatten.ts`, replace the direct read at line 188 with a resolved default. Define the fallback next to the RAG section, sourcing values from `defaults.ts`:

```ts
  // --- RAG ---
  // Omitting `rag` entirely means "not using retrieval". Fall back to the
  // inert mock embedder + in-memory store so downstream readers always see a
  // consistent projection, and so adding retrieval later is purely additive.
  const rag: NonNullable<AskDbConfig["rag"]> = config.rag ?? {
    embedder: "mock",
    embedderConfig: {},
    store: "memory",
    storeConfig: {},
  };
```

Every line below (189-238) then works unchanged, because `mock` + `memory` already take the no-op paths: `resolveRagEmbeddingDimensions` returns `DEFAULT_MOCK_RAG_EMBEDDING_DIMENSIONS` for a non-openai embedder (lines 114-125), and the `memory` store branch at line 220 sets no env keys.

Also widen `resolveRagEmbeddingDimensions`'s parameter type from `AskDbConfig["rag"]` to `NonNullable<AskDbConfig["rag"]>`.

Choose `memory` rather than `file` for the default store deliberately: `file` would emit `ASKDB_RAG_FILE_BASE_PATH` and imply a directory the user never asked for.

**Verify**:
```
pnpm --filter @askdb/config lint
pnpm --filter @askdb/config test
```
→ exit 0, all existing tests pass.

### Step 3: Tests

Add to `packages/config/src/flatten.test.ts`:

1. A config with **no** `rag` block flattens without throwing.
2. That flattened output sets `ASKDB_RAG_EMBEDDER` to `"mock"`.
3. That flattened output contains **no** `ASKDB_PGVECTOR_URL`, no `ASKDB_RAG_FILE_BASE_PATH`, and no `ASKDB_RAG_EMBEDDER_API_KEY`.
4. A config **with** an explicit `rag: { embedder: "mock", embedderConfig: {}, store: "memory", storeConfig: {} }` produces byte-identical output to the omitted case. This is the key equivalence test.
5. Regression: an existing full `rag` block (e.g. `openai` embedder + `pgvector` store) still flattens exactly as before. Copy the expectations from whichever existing test already covers that path.

**Verify**: `pnpm --filter @askdb/config test` → all pass, 5 new cases.

### Step 4: Stop `askdb init` from emitting unnecessary RAG config

`apps/cli/src/init.ts` renders `askdb.config.ts` from an `InitAnswers` object whose shape is declared at lines 13-32 and includes `ragStore: "file" | "memory" | "pgvector"`.

Read the config-rendering function and determine whether the wizard can already express "no RAG". Two outcomes, both acceptable:

- **If `ragStore` is always set** (no "none" option): leave `init.ts` unchanged. Removing an option from the wizard is a UX decision beyond this plan. Note it in your report.
- **If a "none"/skip path exists or is trivially addable without changing the prompt flow**: omit the `rag` block from the rendered config in that case.

Do not restructure the wizard.

**Verify**: `pnpm --filter askdb lint && pnpm --filter askdb test` → exit 0.

### Step 5: Docs and changeset

In `apps/docs-site/src/content/docs/reference/config.mdx`, find the `rag` entry in the config-reference table and mark it optional, with one sentence on the omitted behavior (mock embedder, in-memory store, no `ASKDB_RAG_*` keys beyond the marker). Match the surrounding table formatting.

Create `.changeset/optional-rag-config.md` — **minor** bump for `@askdb/config` (and `askdb` if Step 4 changed `init.ts`). Body: `rag` may now be omitted; existing configs are unaffected; state the defaults applied.

**Verify**: `pnpm build && pnpm lint && pnpm test && pnpm docs:build` → all exit 0.

## Test plan

- Five cases in `packages/config/src/flatten.test.ts` per Step 3.
- Case 4 (omitted ≡ explicit mock/memory) is the one that matters most — it pins the defaults so a future change cannot silently alter what omission means.
- Case 5 guards the existing behavior for configs that do specify RAG.
- Verification: `pnpm --filter @askdb/config test` → all pass.

## Done criteria

ALL must hold:

- [ ] `pnpm --filter @askdb/config lint` exits 0
- [ ] `pnpm test` exits 0 with 5 new config test cases
- [ ] `pnpm build` exits 0
- [ ] `pnpm docs:build` exits 0
- [ ] `grep -n "rag?:" packages/config/src/types.ts` returns a match
- [ ] A config object omitting `rag` typechecks — verify with a temporary `tsc --noEmit` scratch check, then delete the scratch file
- [ ] No `ASKDB_PGVECTOR_URL` or `ASKDB_RAG_FILE_BASE_PATH` key appears in the flattened output for a config with no `rag` block (asserted by the tests)
- [ ] `git diff --name-only packages/rag/` is empty (out-of-scope package untouched)
- [ ] `.changeset/optional-rag-config.md` exists
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Making `rag` optional surfaces more than the one `config.rag` dereference — i.e. `pnpm lint` reports errors in files outside `packages/config/src/flatten.ts`. That means the type is read somewhere this plan did not account for; report the locations rather than patching each one.
- Any existing `flatten.test.ts` case fails. The defaults chosen in Step 2 are meant to be exactly equivalent to today's common filler; a failure means they are not.
- Step 4 turns out to require restructuring the init wizard's prompt flow. Leave `init.ts` alone and say so.
- You conclude `introspection` or `ai` should also be optional. Both are genuinely required; report the argument instead of making the change.

## Maintenance notes

- **The omitted-`rag` defaults are now a contract.** Case 4 in the test suite pins "omitted ≡ mock + memory". Changing either default is a behavior change for every config that omits the block, and needs a changeset entry.
- The same argument applies to `introspection.outputDir`, which has a default already — worth auditing whether other required fields could become optional with sensible defaults. Deliberately not bundled here.
- If `embedderConfig`/`storeConfig` are ever made optional too, the fallback object in Step 2 simplifies further.
- **Reviewer focus**: confirm the default store is `memory`, not `file` — `file` would emit a path env key the user never configured.
