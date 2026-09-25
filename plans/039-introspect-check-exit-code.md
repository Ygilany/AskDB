# Plan 039: Give `askdb introspect` a `--check` mode that fails CI on schema-artifact drift

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat cc1193a..HEAD -- apps/cli/src/introspect.ts` If the file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: PRs #189 (`--diff` correctness via `renderSchemaV2Body`) and #199 (registry-based engine dispatch) merged — see "Post-review delta (2026-09-25)" at the end of this file
- **Category**: dx
- **Planned at**: commit `cc1193a`, 2026-08-05
- **Breaking**: No — a new flag. `--diff`'s current behavior is preserved exactly.

## Why this matters

The schema artifact is a generated file that hosts commit to their repository, while the database it describes keeps evolving through migrations. Nothing currently detects when the two diverge, and a stale artifact does not fail loudly — it produces confidently wrong SQL against columns that no longer exist.

This matters more, not less, because of Studio: enrichment is hand-authored content layered on the artifact, so teams keep the artifact in version control and re-introspect periodically. They need a CI gate that says "the committed artifact no longer matches the database."

Most of the machinery already exists. `askdb introspect --diff <dir>` compares a freshly introspected schema against a committed one, and re-introspection already preserves enrichment (`mergeWithExistingArtifact`). The single missing piece is that `--diff` **always exits 0**, so it cannot gate a CI job without piping its JSON through `jq`. This plan adds the exit code and a human-readable summary.

## Current state

### `--diff` today

`apps/cli/src/introspect.ts:251-260`:

```ts
  if (opts.diff) {
    const result = await introspect(input, undefined, { connector });
    const generated = `${JSON.stringify(toV2SchemaJson(result.schema, schemaId), null, 2)}\n`;
    const existingPath = join(opts.diff, "schema.json");
    const existing = existsSync(existingPath) ? readFileSync(existingPath, "utf8") : "";
    process.stdout.write(
      `${JSON.stringify({ changed: generated !== existing, schemaJsonPath: existingPath }, null, 2)}\n`,
    );
    return result;
  }
```

It emits `{"changed": true|false, "schemaJsonPath": "..."}` and returns the result. The caller, `runIntrospectCommand`, then unconditionally `return 0` (line 227) regardless of `changed`.

### Option parsing

`CliOptions` declares `diff?: string;` at line 56. The parser handles it at lines 302-304:

```ts
      case "--diff":
        opts.diff = readValue(argv, ++i, arg);
        break;
```

Output-mode exclusivity is enforced at lines 166-176:

```ts
  if (!opts.print && !opts.diff && !opts.out) {
    throw new Error(
      "Provide one output mode: --out <dir>, --print, or --diff <existing-dir> (or set ASKDB_INTROSPECT_OUT to default --out).",
    );
  }
  if ([opts.print, Boolean(opts.diff), Boolean(opts.out)].filter(Boolean).length > 1) {
    throw new Error("Use only one output mode: --out, --print, or --diff.");
  }
```

### Exit-code conventions in this CLI

`runIntrospectCli` returns a `Promise<number>` (line 69) and every path returns an explicit code: `0` for success (lines 73, 77, 105, 227), `1` for errors (line 85). There is no existing "drift detected" code, so `2` is free — using a distinct code lets a caller tell drift apart from a crash.

Warnings are surfaced through the logger, `apps/cli/src/introspect.ts:212-217`:

```ts
    for (const warning of result.warnings) {
      logger.info(
        { event: INTROSPECT_EVENTS.warning, warning },
        "askdb introspection warning",
      );
    }
```

### Convention to match

The help text lives in `printHelp()` and lists usage lines around lines 407-422, with an environment-variable section below. Add the new flag in the same format. Tests for this CLI are in `apps/cli/src/` alongside the source — find the existing introspect tests with `ls apps/cli/src/*.test.ts` and match their structure.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Build | `pnpm --filter askdb build` | exit 0 |
| Typecheck | `pnpm --filter askdb lint` | exit 0 |
| Tests | `pnpm --filter askdb test` | all pass |
| Full gate | `pnpm build && pnpm lint && pnpm test` | exit 0 |
| Help output | `pnpm exec askdb introspect --help` | prints usage |

## Scope

**In scope**:
- `apps/cli/src/introspect.ts`
- The CLI's introspect test file (locate with `ls apps/cli/src/*.test.ts`)
- `docs/integration/installable-package.md` — a short CI-usage section
- `.changeset/introspect-check-flag.md` (create)

**Out of scope** (do NOT touch):
- `packages/introspect/**`. Enrichment-preserving merge (`mergeWithExistingArtifact`) and orphan detection (`findOrphanWarnings`) already exist in `packages/introspect/src/render/render.ts` and work correctly. This plan does not change introspection itself, only how the CLI reports a comparison.
- The `--diff` JSON output shape. Existing scripts may parse it; keep it byte-identical.
- `--out` and `--print` behavior.
- Adding a GitHub Actions workflow. Documenting the command is in scope; wiring up this repo's own CI is a separate decision.

## Git workflow

- Branch: `advisor/039-introspect-check-exit-code`
- Commit message style e.g. `feat(cli): add introspect --check for CI drift gating`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the `--check` flag to option parsing

In `apps/cli/src/introspect.ts`, add `check?: boolean;` to `CliOptions` (near the `diff?: string;` declaration at line 56), and a parser case alongside `--diff`:

```ts
      case "--check":
        opts.check = true;
        break;
```

`--check` is a **modifier on `--diff`**, not a fourth output mode. Therefore:

- Do NOT add it to the exclusivity check at lines 166-176.
- Add a validation immediately after that block: if `opts.check` is set but `opts.diff` is not, throw `"--check requires --diff <existing-dir>."`.

**Verify**: `pnpm --filter askdb lint` → exit 0.

### Step 2: Thread the drift result out of `runWithOutput`

`runWithOutput` currently returns the introspection result only, so the caller cannot see whether the comparison found a difference. Widen its return so the diff branch can report `changed`.

Keep the change minimal — return the existing result plus an optional flag, e.g. an object `{ result, changed?: boolean }`, and update the three return sites (`--print` at line 245-249, `--diff` at 251-260, and the `--out` fall-through at 262-271) plus the single call site in `runIntrospectCommand` (line 211).

Do not change the JSON written to stdout in the `--diff` branch.

**Verify**: `pnpm --filter askdb lint && pnpm --filter askdb build` → exit 0.

### Step 3: Return exit code 2 on drift, with a readable summary

In `runIntrospectCommand`, after the existing warning loop (lines 212-217) and the `completed` log (lines 218-226), replace the bare `return 0` at line 227 with logic that:

- Returns `0` when `--check` was not passed (unchanged behavior for every existing invocation).
- When `--check` was passed and `changed` is `false`: write a one-line confirmation to stdout, e.g. `Schema artifact is up to date: <schemaJsonPath>`, and return `0`.
- When `--check` was passed and `changed` is `true`: write a message to **stderr** naming the path and the remedy, e.g.
  ```
  Schema artifact is out of date: <schemaJsonPath>
  Regenerate it with: askdb introspect --out <dir>
  ```
  and return `2`.

Also surface orphan warnings in check mode. `result.warnings` already contains them; when `--check` is set and `warnings.length > 0`, write each to stderr as well as logging it, so a CI log shows them without needing debug-level logging enabled.

**Verify**:
```
pnpm --filter askdb build
pnpm --filter askdb lint
```
→ exit 0 for both.

### Step 4: Update the help text

In `printHelp()`, add a usage line next to the existing `--diff` examples (around lines 407-417) and a flag description in the same style as the surrounding entries:

```
  askdb introspect --diff <existing-dir> --check      (exit 2 when the artifact is stale)
```

Document the exit codes explicitly somewhere in the help output: `0` = up to date (or normal success), `1` = error, `2` = drift detected.

**Verify**:
```
pnpm --filter askdb build
pnpm exec askdb introspect --help | grep -c -- "--check"
```
→ at least `1`.

### Step 5: Tests

Add to the CLI's introspect test file. Because these tests must not touch a real database, use the `--from-export <bundle-dir>` input path, which the CLI already supports (see the usage line at `apps/cli/src/introspect.ts:417`) — find an existing test that uses it and follow that setup.

Cases:

1. `--diff <dir>` without `--check` against a **matching** artifact → exit 0, stdout JSON has `"changed": false`.
2. `--diff <dir>` without `--check` against a **stale** artifact → exit **0** (unchanged legacy behavior — this is the regression guard), stdout JSON has `"changed": true`.
3. `--diff <dir> --check` against a matching artifact → exit 0.
4. `--diff <dir> --check` against a stale artifact → exit **2**, and stderr mentions the artifact path.
5. `--check` without `--diff` → throws / exits 1 with a message containing `--check requires --diff`.

Case 2 is the important one: it proves `--check` is opt-in and no existing pipeline changes behavior.

**Verify**: `pnpm --filter askdb test` → all pass, 5 new cases.

### Step 6: Document the CI recipe and write the changeset

Add a short section to `docs/integration/installable-package.md` — read the file first and match its heading depth and code-fence style. It should show:

```bash
# Fails the build (exit 2) when the committed artifact no longer matches the database.
askdb introspect --diff ./askdb --check
```

with a sentence on why: the artifact is generated but committed, migrations move the database underneath it, and a stale artifact produces SQL against columns that no longer exist. Mention that re-introspecting with `--out` preserves Studio enrichment, so regenerating is safe.

Create `.changeset/introspect-check-flag.md` — **minor** bump for `askdb`. Body: new `--check` modifier for `--diff`, exit-code table, and the note that `--diff` alone is unchanged.

**Verify**: `pnpm build && pnpm lint && pnpm test && pnpm docs:build` → all exit 0.

## Test plan

- Five cases in the CLI introspect test file, per Step 5, driven through `--from-export` so no database is required.
- The regression guard is case 2 — `--diff` alone must still exit 0 on drift.
- Verification: `pnpm --filter askdb test` → all pass.

## Done criteria

ALL must hold:

- [ ] `pnpm build` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `pnpm test` exits 0 with 5 new CLI test cases
- [ ] `pnpm docs:build` exits 0
- [ ] `pnpm exec askdb introspect --help | grep -q -- "--check"` succeeds
- [ ] `pnpm exec askdb introspect --check` (no `--diff`) exits non-zero and mentions `--check requires --diff`
- [ ] The `--diff` stdout JSON shape is byte-identical to before — confirm by diffing captured output from case 1 against the pre-change behavior
- [ ] `git diff --name-only packages/introspect/` is empty (out-of-scope package untouched)
- [ ] `.changeset/introspect-check-flag.md` exists
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Threading `changed` out of `runWithOutput` (Step 2) requires changing more than the three return sites and the one call site. A larger refactor of that function is out of scope.
- You find that `--diff`'s comparison produces `changed: true` for a *freshly generated, unmodified* artifact — that would mean the serialization is not deterministic (key ordering, timestamps), which is a separate and more serious bug. Report it; do not paper over it with normalization inside `--check`.
- Adding `--check` to the output-mode exclusivity check seems necessary. It is a modifier, not a mode; if the parser structure resists that, report why.
- You cannot write the tests without a live database connection.

## Maintenance notes

- **The exit-code contract is now public**: `0` up to date, `1` error, `2` drift. Changing these breaks people's CI. Document any future code in the help text and the changeset.
- The determinism of `toV2SchemaJson` output is what makes `--check` meaningful. If a future change introduces any non-deterministic field (a timestamp, a generation id, an unsorted map), `--check` will report drift on every run and teams will disable it. Guard that with a test that introspects the same export twice and asserts identical output.
- **Natural follow-up**: `--check` currently answers yes/no. A summary of *what* changed (tables added/removed/altered) would make the CI failure actionable. Deliberately deferred — it needs a schema-diff algorithm, which is much larger than this plan.
- **Reviewer focus**: confirm case 2 exists and passes — that `--diff` without `--check` still exits 0 — since that is the entire backwards-compatibility guarantee.

## Post-review delta (2026-09-25)

Verified against `review/integration-check @ c7404d4` (origin/main plus review PRs #180–#205). **Read this section before the body.** Where the two disagree, this section wins. The goal, the exit-code contract (`0` up to date, `1` error, `2` drift), and the rule that `--check` is a modifier on `--diff` (not a fourth output mode) are unchanged.

### Why the plan was stale, and what changed

- **#189 fixed `--diff` itself.** Before it, `--diff` compared against `toV2SchemaJson(result.schema, schemaId)`, which dropped the `provider` field that `--out` writes and skipped the ID-anchored merge. So `--diff` reported `changed: true` against almost any artifact, and a `--check` built on it would have failed every CI run. That is the STOP condition "`changed: true` for a freshly generated, unmodified artifact", and it was real. #189 added `renderSchemaV2Body(schema, { schemaId, provider?, existingArtifactDir? })` in `packages/introspect/src/render/render.ts`. It is the one pure function that `--out`, `--print` and `--diff` all use. `--diff` now merges with the existing artifact (so human-set `sensitive` flags are not drift) and compares ignoring key order. **This plan now depends on #189**, and that STOP condition is resolved. Keep it as a regression guard only.
- **#199 moved engine dispatch into the connector registry.** `apps/cli/src/introspect.ts` has no per-engine `if (engine === …)` block any more. `runIntrospectCommand` calls `resolveEngine(registry, …)`, then `registry.resolveConnection(engine, { explicit, runtime: rt, surface: "cli" })`, then `registry.createConnector(connectorConfig)`. `runIntrospectCli(argv, { connectorRegistry })` accepts an injected registry (default `defaultConnectorRegistry`). This does not change what `--check` must do, but it gives Step 5 a much better test harness (below).

### Updated "Current state" references (c7404d4, `apps/cli/src/introspect.ts`)

- `CliOptions` declares `diff?: string;` (around line 64). Add `check?: boolean;` next to it.
- The parser `case "--diff": opts.diff = readValue(argv, ++i, arg); break;` is in `parseOptions` (around lines 306–308).
- Output-mode handling is now at lines 138–148, and there is a **new first block**: `if (!opts.print && !opts.diff && !opts.out) { opts.out = rt.introspection.outputDir; }`. So a bare `askdb introspect --check` (no `--diff`) would otherwise be defaulted into `--out` mode, or would fail with the generic "Provide one output mode" error when no `outputDir` is configured. Put the `--check requires --diff <existing-dir>.` validation **before** that defaulting block, so the user always gets the specific message.
- `runWithOutput(runConfig, opts, schemaId)` (lines 209–257) still has exactly three return sites: `--print` (217–225), `--diff` (227–245), `--out` fall-through (247–256). There is one call site, `const result = await runWithOutput(runConfig, opts, schemaId);` (line 183). Step 2's "three return sites + one call site" budget still holds.
- The `--diff` branch now reads:
  ```ts
  const rendered = renderSchemaV2Body(result.schema, {
    schemaId,
    provider: result.provider,
    existingArtifactDir: hasExisting && isV2SchemaFile(existingPath) ? opts.diff : undefined,
  });
  const existing = hasExisting ? readFileSync(existingPath, "utf8") : "";
  const changed = rendered.body !== existing && !sameJson(existing, rendered.json);
  process.stdout.write(`${JSON.stringify({ changed, schemaJsonPath: existingPath }, null, 2)}\n`);
  ```
  Thread **this** `changed` value out. Do not recompute it. The stdout JSON shape `{ changed, schemaJsonPath }` must stay byte-identical. A missing `schema.json` yields `changed: true`, which `--check` should report as drift (exit 2) with a message that says the artifact does not exist.
- The unconditional `return 0` after the `completed` log is now around line 199. The warnings loop is at 184–189, and `result.warnings` now includes the render warnings (`new_column`, `orphan_id`) because both `--print` and `--diff` append `rendered.warnings`.
- `printHelp()` is at lines 396–434. The `--diff` usage lines are `askdb introspect --engine prisma --prisma-schema <…> --diff <existing-dir>` and `askdb introspect --from-export <bundle-dir> --diff <existing-dir>`.

### Step changes

- **Steps 1–4**: still valid, with the line references above and the ordering fix for the `--check requires --diff` validation in Step 1.
- **Step 5 (tests)**: prefer in-process tests through the injected registry over spawning the CLI with `--from-export`. `apps/cli/src/introspect-registry.test.ts` already shows the pattern: `setAskDbRuntimeForTests(…)`, a fake `ConnectorProviderAdapter` (`acmeAdapter()`) whose connector returns a fixed `IntrospectionResult`, and `runIntrospectCli([...], { connectorRegistry: createConnectorRegistry([adapter]) })`. Write the "matching" artifact with a first `--out <tmp>` run, then run `--diff <tmp> [--check]`. Make it "stale" by changing the fake result, for example adding a column. The five cases are unchanged. Add a **sixth**: after `--out`, flip a `sensitive` flag in the written `schema.json`, then `--diff --check` → exit 0 (the #189 merge must keep sensitivity edits from counting as drift). For one end-to-end spawn case, reuse the Prisma pattern in `apps/cli/src/introspect-shim.test.ts` ("--diff reports unchanged against an artifact written by --out from the same source"), which needs no database. Apply the test-audit authoring gate (`.agents/skills/test-audit/SKILL.md`). The owner boundary is `runIntrospectCli`'s exit code, and the regressions caught are drift not failing CI, and `--diff` alone starting to fail CI.
- **Step 6 (docs)**: besides `docs/integration/installable-package.md` (its `## Introspection` section, around line 112, is the place), AGENTS.md requires the docs site to stay accurate. Add `--check` to the flag table in `apps/docs-site/src/content/docs/reference/cli.mdx` (`### askdb introspect`; the table currently ends with ``| `--diff <existing>` | Diff against an existing schema artifact. |``), and put the exit codes and a one-line CI example under it. Also update the `--diff` bullet in `docs/specs/introspection.md` "In scope".
- **Changeset**: still `askdb` minor. `askdb` is in a `linked` group with `@askdb/core` and `@askdb/http-api` (`.changeset/config.json`). Run `pnpm changeset status` and confirm nothing else moves unexpectedly.

### Commands (current repo)

Use `pnpm --filter askdb exec vitest run --config ../../vitest.config.ts src/introspect-registry.test.ts` for the fast loop. Before the PR, run `pnpm build && pnpm lint && pnpm test && pnpm docs:build && pnpm smoke:install && pnpm preflight`. The CLI tests execute `dist/cli.js`, which Turbo builds before `test` (#180 removed the in-test builds), so run `pnpm build` first when using vitest directly.

### Interactions with newer plans

- **Plan 062** (renderer fidelity) adds `comment`/`enum`/`relationships[].constraint` to `schema.json`. The first `--diff --check` after upgrading will report drift for databases with comments, enums or composite FKs. That is correct behavior (the artifact really is out of date), but mention it in the CLI docs' CI example.
- **Plan 064** adds `partition_fk_partial` / `partition_fk_conflict` warnings. In check mode they are printed to stderr like other warnings (Step 3) and do **not** affect the exit code. Only `changed` does.
- Branch name per the current convention: `plan/039-introspect-check-exit-code`.
