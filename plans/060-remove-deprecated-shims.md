# Plan 060: Remove the deprecated `@askdb/ai-*` and `@askdb/connectors` shim packages before 1.0

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report. When done, update this plan's row in `plans/README.md`, unless a reviewer dispatched you and said they maintain the index.
>
> **Readiness check (run first)**: every command must print the expected result, or STOP. The **release gate** (items 3 and 4) is not optional: deleting a package before any published version tells users it is deprecated strands them without a migration path.
>
> ```bash
> # 1. The PRs that turned these packages into shims are merged.
> for n in 198 199; do gh pr view $n --repo Ygilany/AskDB --json state -q .state; done        # → MERGED ×2
> # 2. The packages are still shims in the workspace (the problem exists).
> cat packages/ai-openai/src/index.ts | grep -c "export { openaiProvider } from \"@askdb/ai\""   # → 1
> grep -c "deprecated compatibility shim" packages/connectors/src/index.ts                      # → 1
> # 3. RELEASE GATE: npm has a shim release newer than the last pre-shim versions
> #    (ai-openai/azure/google 1.0.0-beta.6, ai-anthropic 1.0.0-beta.4, connectors 0.1.0-beta.7 on 2026-09-25).
> for p in ai-openai ai-azure ai-google ai-anthropic connectors; do echo "$p $(npm view @askdb/$p version)"; done
> #    → every version is HIGHER than the ones listed above
> # 4. RELEASE GATE: that published version carries the deprecation README.
> for p in ai-openai ai-azure ai-google ai-anthropic connectors; do npm view @askdb/$p readme | head -3 | grep -ci deprecated; done   # → ≥1 each
> ```
>
> If items 3 or 4 fail, the shim release hasn't shipped yet. STOP and report "blocked on release". Don't work around the gate.

## Status

- **Priority**: P2 (must land before any 1.0 / `rc` tag)
- **Effort**: M
- **Risk**: LOW for code (nothing first-party imports the shims). MED for release mechanics (changesets pre mode).
- **Depends on**: #198, #199, and **a published release containing their shim versions**. Soft dependency on plan 057 and plan 059, which also defer removals "to the 1.0 cutover". Coordinate if the maintainer wants a single breaking release.
- **Category**: migration
- **Planned at**: `review/integration-check @ c7404d4, 2026-09-25`
- **Breaking**: yes. Five packages stop being developed or published. Existing installs keep working at their last published version, and `npm deprecate` steers users away.

## Why this matters

#198 folded the four provider adapters into `@askdb/ai`, and #199 moved the connector registry into `@askdb/introspect`. Each left a re-export shim so imports keep working, and each shim says it "will be removed before 1.0".

Every remaining shim is a release unit that gets version-bumped, packed, smoke-tested, and changelogged. Changesets frontmatter keeps naming them, and the docs keep explaining them. Removing them before 1.0 avoids having to commit to them under semver.

## Current state

Verified on `review/integration-check @ c7404d4`, with npm checked on 2026-09-25.

- **Shim sources**:
  - `packages/ai-{openai,azure,google,anthropic}/src/index.ts` each re-export one adapter from `@askdb/ai`, e.g. `export { openaiProvider } from "@askdb/ai";`.
  - `packages/connectors/src/index.ts` re-exports the registry from `@askdb/introspect`, and the redaction helpers `REDACTED_SECRET`, `hasUrlScheme`, `isSecretConnectionKey`, `redactConnectionStringGeneric`, `redactSecretKeyValues`, `redactUrlUserinfo`, and `RedactKeyValueOptions` from `@askdb/introspect/kit`.
- **Manifests**: the four `ai-*` packages list `vitest` in `devDependencies` but have no `test` script (leftovers). `connectors` has a `test` script and `src/index.test.ts`.
- **npm today**: `@askdb/connectors@latest` = `0.1.0-beta.7`. Its published `dist/index.d.ts` exports only the registry: `createConnectorRegistry, connectorProviderMissingMessage, CONNECTOR_PROVIDERS, ConnectorProvider, ConnectorConfig, ConnectorResult, ConnectorProviderAdapter, ConnectorProviderAdapters, ConnectorRegistry`. **The redaction re-exports have never been published.** To re-check, run `npm pack @askdb/connectors@latest && tar xzf askdb-connectors-*.tgz && grep -n redact package/dist/*.d.ts`; no output means unpublished.
- **Nothing first-party imports a shim.** `git grep -n -E "from \"@askdb/(ai-openai|ai-azure|ai-google|ai-anthropic|connectors)\"" -- apps packages ':!packages/ai-*' ':!packages/connectors'` → no matches. The only consumers are the installable smoke test and docs.
- **References to clean up** (from `git grep -n -E "@askdb/(ai-openai|ai-azure|ai-google|ai-anthropic|connectors)|packages/(ai-|connectors)"`):
  - `examples/installable-smoke/run.sh`: packs `packages/ai-openai` … `packages/connectors` in the `for pkg in …` list, plus the `*_TARBALL` variables and `@askdb/ai-openai` / `@askdb/connectors` deps.
  - `examples/installable-smoke/consumer/package.json` (`"@askdb/ai-openai": "__ASKDB_AI_OPENAI_TARBALL__"`).
  - `examples/installable-smoke/consumer/src/smoke.ts` (the `deprecatedShimOpenaiProvider` import and assertion).
  - `README.md` (package list, lines naming the shims).
  - `docs/architecture.md` (the `connectors` Mermaid nodes and edges, and the two table rows).
  - `docs/specs/distribution.md` (the package list and two table rows).
  - `docs/specs/introspection.md`, `docs/integration/connectors.md`, `docs/integration/installable-package.md`.
  - `docs/adrs/0006-ai-provider-integration-strategy.md` ("Deferred: … deleting the shims") and `docs/adrs/0008-engine-packages-and-connector-registry.md` ("Removing `@askdb/connectors` (a future major can drop the shim)").
  - `apps/docs-site/src/content/docs/reference/packages.mdx` (the deprecation paragraph, the `@askdb/connectors (deprecated)` section, and two migration-table rows).
  - `apps/docs-site/src/content/docs/guides/bring-your-own-model.mdx` (one deprecation sentence) and `apps/docs-site/public/AGENTS.md` (one sentence).
  - `packages/ai/README.md` (one blockquote).
  - `.agents/skills/new-ai-adapter/SKILL.md` ("the four `@askdb/ai-*` packages that still exist are deprecated re-export shims") and `.agents/skills/test-audit/SKILL.md` (lists `packages/connectors`).
- **Root `AGENTS.md` lines that are stale after #198** (exact text on c7404d4):
  - `- \`packages/ai\`, \`packages/ai-*\` — AI provider registry and adapters (openai/anthropic/google/azure).`
  - `- \`@askdb/ai-*\` adapters and raw Vercel AI SDK \`LanguageModel\` objects are both first-party, equally supported ways to give \`ask()\` a model …`
  - `- Provider adapters declare \`ai\` and \`@askdb/ai\` as peer dependencies — don't hard-pin AI SDK versions inside adapters; let the host app's \`package.json\` pin them.`
- **Changesets pre mode**: `.changeset/pre.json` has `"mode": "pre"` and lists all five packages in `initialVersions`. `@changesets/assemble-release-plan` `getRelevantChangesets` validates **every** `.changeset/*.md`, including ones already consumed in pre mode, and throws `Found changeset <id> for package <name> which is not in the workspace` for an unknown package. 18 changeset files name a shim package (`grep -l -E '^"@askdb/(ai-openai|ai-azure|ai-google|ai-anthropic|connectors)"' .changeset/*.md`). Extra `initialVersions` keys are harmless: `getPreInfo` iterates workspace packages only.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install / build / lint / test | `pnpm install && pnpm build && pnpm lint && pnpm test` | exit 0 |
| Changesets | `pnpm changeset status --verbose` | exit 0, no "not in the workspace" error |
| Docs / release | `pnpm docs:build && pnpm smoke:install && pnpm preflight` | exit 0 |

## Scope

**In scope**:
- Delete the `packages/ai-openai`, `packages/ai-azure`, `packages/ai-google`, `packages/ai-anthropic`, and `packages/connectors` directories.
- `pnpm-lock.yaml`, regenerated by `pnpm install`.
- `.changeset/*.md` frontmatter lines that name removed packages.
- A new `.changeset/remove-deprecated-shims.md`.
- Every file in "References to clean up", plus root `AGENTS.md`.

**Out of scope**:
- Running `npm deprecate` or `npm unpublish`. **Human step**, see Step 5. Never unpublish: it breaks existing lockfiles.
- Deprecated APIs *inside* live packages, such as `createOpenAiEmbedder` or `aiKeyMissingMessage`. Those are separate cutover items (plans 057, 058, 059).
- `CHANGELOG.md` files of other packages that mention the shims. They are history.
- Exiting pre mode, or `fixed`/`linked` changes in `.changeset/config.json`. Those are maintainer release decisions.

## Git workflow

- Branch `plan/060-remove-deprecated-shims`. Commit style: `chore!: remove deprecated @askdb/ai-* and @askdb/connectors shims`.
- Open one PR and don't merge it.

## Steps

### Step 1: Delete the packages and refresh the lockfile

`git rm -r packages/ai-openai packages/ai-azure packages/ai-google packages/ai-anthropic packages/connectors`, then run `pnpm install`.

The leftover `vitest` devDependencies in the `ai-*` shims go with the directories. If the maintainer defers deletion, drop those `vitest` entries instead, since those packages have no tests.

**Verify**:
- `pnpm install` → exit 0.
- `grep -c -E "packages/(ai-openai|ai-azure|ai-google|ai-anthropic|connectors):" pnpm-lock.yaml` → `0`.
- `pnpm build && pnpm lint` → exit 0.

### Step 2: Fix the installable smoke test

- `run.sh`: remove the five packages from the `for pkg in …` pack list, and delete the `AI_*_TARBALL` / `CONNECTORS_TARBALL` lookups and every `@askdb/ai-openai` / `@askdb/connectors` dependency injection.
- `consumer/package.json`: remove the `@askdb/ai-openai` placeholder.
- `consumer/src/smoke.ts`: delete the `deprecatedShimOpenaiProvider` import and its assertion.
- Add one assertion instead: no packed tarball matches `askdb-ai-openai-*` or `askdb-connectors-*`. That guards against a package being re-added to the pack list.

**Verify**: `pnpm smoke:install` → exit 0.

### Step 3: Make changesets accept the deletion

For each file from `grep -l -E '^"@askdb/(ai-openai|ai-azure|ai-google|ai-anthropic|connectors)"' .changeset/*.md`, delete only the frontmatter lines naming removed packages. If that leaves an empty frontmatter block (`---\n---`), keep the file: changesets accepts empty changesets, and pre.json may reference its id. Leave `.changeset/pre.json` unchanged.

Create `.changeset/remove-deprecated-shims.md` with `"@askdb/ai": patch` and `"@askdb/introspect": patch`. The body should say that `@askdb/ai-openai`, `@askdb/ai-azure`, `@askdb/ai-google`, `@askdb/ai-anthropic`, and `@askdb/connectors` are no longer published, and give the replacement imports. A changeset can't name a deleted package, so the release note has to live on the surviving packages.

**Verify**: `pnpm changeset status --verbose` → exit 0, with no "not in the workspace" message and no `major` bump.

### Step 4: Docs, ADRs, skills, AGENTS.md

- **`apps/docs-site/.../reference/packages.mdx`**: delete the deprecated-shims paragraph and the `@askdb/connectors (deprecated)` section. **Keep** the two migration-table rows, reworded to "removed in `<version>`" so readers upgrading from old versions still find the replacement.
- **`bring-your-own-model.mdx`** and **`apps/docs-site/public/AGENTS.md`**: replace the "deprecated" sentences with one line: "the former `@askdb/ai-*` packages were removed; use `@askdb/ai` + the `@ai-sdk/*` package".
- **Repo docs** (`README.md`, `docs/architecture.md` including both Mermaid diagrams, `docs/specs/distribution.md`, `docs/specs/introspection.md`, `docs/integration/connectors.md`, `docs/integration/installable-package.md`, `packages/ai/README.md`): remove the shim rows, nodes, and sentences.
- **ADR 0006 and ADR 0008**: append a dated one-paragraph note, "2026-xx: shims removed in `<version>`", to each. Don't rewrite the decision text.
- **Skills**:
  - `new-ai-adapter/SKILL.md`: change "the four `@askdb/ai-*` packages that still exist are deprecated re-export shims scheduled for removal" to "the former `@askdb/ai-*` packages were removed".
  - `test-audit/SKILL.md`: drop `packages/connectors` from the database-layer list.
- **Root `AGENTS.md`**: replace the three stale lines quoted in "Current state" with:
  - `- \`packages/ai\` — AI provider registry with built-in providers (OpenAI, Anthropic, Google, Azure/Foundry, Vercel AI Gateway); \`@ai-sdk/*\` packages are optional peers loaded lazily.`
  - `- \`@askdb/ai\` (config-driven) and raw Vercel AI SDK \`LanguageModel\` objects are both first-party, equally supported ways to give \`ask()\` a model — don't privilege one over the other in new docs or examples without a reason tied to who owns provider config.`
  - `- \`ai\` and the \`@ai-sdk/*\` provider SDKs are peer dependencies of library packages (optional peers of \`@askdb/ai\`) — don't hard-pin AI SDK versions in library packages; let the host app's \`package.json\` pin them.`

  Verify each claim against `packages/ai/package.json` and `packages/core/package.json` before writing it.

**Verify**:
- `git grep -n -E "@askdb/(ai-openai|ai-azure|ai-google|ai-anthropic|connectors)" -- ':!*CHANGELOG.md' ':!plans' ':!docs/reviews' ':!.changeset'` → only the reworded migration-table rows in `packages.mdx` and the ADR notes.
- `pnpm docs:build` → exit 0.

### Step 5: Human steps (list them in the PR description; the executor does NOT run them)

After this PR merges and the next release publishes, a maintainer with npm owner rights and 2FA runs:

```bash
npm deprecate "@askdb/ai-openai@*"    "Built into @askdb/ai. Install @askdb/ai and @ai-sdk/openai. https://askdb.tools/reference/packages/"
npm deprecate "@askdb/ai-azure@*"     "Built into @askdb/ai. Install @askdb/ai and @ai-sdk/azure. https://askdb.tools/reference/packages/"
npm deprecate "@askdb/ai-google@*"    "Built into @askdb/ai. Install @askdb/ai and @ai-sdk/google. https://askdb.tools/reference/packages/"
npm deprecate "@askdb/ai-anthropic@*" "Built into @askdb/ai. Install @askdb/ai and @ai-sdk/anthropic. https://askdb.tools/reference/packages/"
npm deprecate "@askdb/connectors@*"   "Moved into @askdb/introspect (registry) and @askdb/introspect/kit (redaction). https://askdb.tools/reference/packages/"
```

Check with `npm view @askdb/ai-openai deprecated` → the message. Also fix the stale `beta` dist-tags on these packages (e.g. `ai-openai` `beta` → `0.1.0-beta.1`): point `beta` at the final shim version, or remove it with `npm dist-tag rm`. The review lists this under "npm dist-tags".

## Decision: `@askdb/connectors` redaction re-exports

They were added by #199 and have **never been on npm** (see "Current state"). No published consumer can depend on them, so removing the package owes them no compatibility step, and nothing in this plan preserves them.

If the release gate hasn't passed yet and the maintainer is still preparing the shim release, it's better to drop the redaction re-exports from the shim first, so they are never published at all. That is a one-file change to `packages/connectors/src/index.ts` plus its README table. Raise this with the maintainer. Don't do it in this PR.

## Test plan (apply the test-audit authoring gate)

No new unit tests. There is no behavior to protect, only absence. The owner boundary for "what ships" is the installable smoke test. Step 2 swaps the shim assertion for a "no shim tarball is packed" assertion. It catches one credible regression: a later PR re-adding a package directory, or the pack list, and republishing a shim. `packages/connectors/src/index.test.ts` is deleted with the package, and its re-export assertions guard nothing once the package is gone.

## Done criteria

- [ ] The readiness check passed, including the release gate. The PR description records the npm versions seen.
- [ ] `ls packages | grep -E "^(ai-(openai|azure|google|anthropic)|connectors)$"` → no output.
- [ ] `pnpm build && pnpm lint && pnpm test && pnpm docs:build && pnpm smoke:install && pnpm preflight` → exit 0.
- [ ] `pnpm changeset status --verbose` → exit 0, no `major`.
- [ ] The Step 4 `git grep` returns only the allowed matches. Root `AGENTS.md` no longer mentions `@askdb/ai-*`.
- [ ] The PR description lists the Step 5 human commands.

## STOP conditions

- The release gate fails. The shim versions aren't on npm yet.
- `pnpm changeset status` still errors after the frontmatter edits. That points to a pre-mode quirk; report the exact message instead of editing `pre.json`.
- Any non-doc file outside the in-scope list imports a removed package. A new consumer appeared after c7404d4.
- `pnpm preflight` or the release workflow (PR #179, if merged) enumerates packages by name and fails on the missing ones.

## Maintenance notes

- This is the model for the other pre-1.0 removals: the `askdb-rag` stub bin (plan 059), `AiProviderAdapter.resolveProviderOptions` (plan 057), `rag.embedderConfig.openai` (plan 058), and `createOpenAiEmbedder`. Batching them into one breaking release keeps the upgrade note in one place.
- Once pre mode exits, consumed changesets are deleted by `changeset version`, and Step 3's frontmatter edits stop mattering.
