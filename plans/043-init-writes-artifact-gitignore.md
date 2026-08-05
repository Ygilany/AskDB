# Plan 043: Have `askdb init` write a `.gitignore` into the schema artifact directory

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat cc1193a..HEAD -- apps/cli/src/init.ts` If the file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `cc1193a`, 2026-08-05
- **Breaking**: No — one additional file written by `askdb init`, and only when it does not already exist.

## Why this matters

`askdb init` scaffolds a project with `introspection.outputDir` defaulting to a directory such as `./askdb`. That directory is *meant* to be committed — it holds `schema.json` and, once Studio enrichment starts, hand-authored markdown.

Because it is the AskDB directory, it is also where people naturally put AskDB credentials. A reviewed integration had a `.env` file containing a database connection string and an AI provider API key sitting directly beside the committed `schema.json`. In that repository it happened to be caught by a generic `.env` rule in a parent `.gitignore` — but that is luck, not design. The recommended layout puts secrets inside a directory whose entire purpose is to be committed, and a single `git add -f`, a differently-scoped ignore file, or a `.env.local` variant turns that into a leaked credential.

Writing a small `.gitignore` into the artifact directory at init time removes the failure mode at the point where the layout is created, and costs one file.

**Note for the executor**: do not go looking for, read, print, or reproduce any credential values while working on this plan. The fix is structural.

## Current state

### Where init writes files

`apps/cli/src/init.ts:979-1006` — `finishInit` writes the config, then conditionally writes `.env.example` beside it:

```ts
async function finishInit(
  configTarget: string,
  answers: InitAnswers,
  opts: InitOptions,
  installer: InstallFn,
): Promise<number> {
  const configContent = renderInitConfig(answers);

  try {
    writeFileSync(configTarget, configContent, { encoding: "utf8" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`Failed to write config: ${msg}\n`);
    return 1;
  }

  process.stdout.write(`Wrote:\n  - ${configTarget}\n`);

  const envExamplePath = join(dirname(configTarget), ".env.example");
  if (!existsSync(envExamplePath)) {
    try {
      writeFileSync(envExamplePath, buildEnvExample(answers), { encoding: "utf8" });
      process.stdout.write(`  - ${envExamplePath}\n`);
    } catch {
      // non-fatal — config was written successfully
    }
  }
```

The `.env.example` block is the exact pattern to copy: check `existsSync`, write, echo the path, swallow errors as non-fatal.

### Where the artifact directory comes from

`InitAnswers` is declared at `apps/cli/src/init.ts:13-32` and includes `schemaOut: string;` (line 18). It is used by `renderIntrospectionSection` at lines 80-82:

```ts
function renderIntrospectionSection(answers: InitAnswers): string {
  const { database, connectionEnv, sqliteFile, prismaSchema, schemaOut } = answers;
  const outputDirLine = `\n    outputDir: "${schemaOut}",`;
```

so `answers.schemaOut` is available inside `finishInit` with no plumbing.

### Imports available

`apps/cli/src/init.ts:2` already imports what is needed:

```ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
```

`join` and `dirname` are already imported from `node:path` (they are used at line 997). You will additionally need `mkdirSync`, since the artifact directory does not exist until the first `introspect` run.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Build | `pnpm --filter askdb build` | exit 0 |
| Typecheck | `pnpm --filter askdb lint` | exit 0 |
| Tests | `pnpm --filter askdb test` | all pass |
| Full gate | `pnpm build && pnpm lint && pnpm test` | exit 0 |

## Scope

**In scope**:
- `apps/cli/src/init.ts`
- The CLI's init test file (locate with `ls apps/cli/src/*.test.ts`)
- `.changeset/init-artifact-gitignore.md` (create)

**Out of scope** (do NOT touch):
- Changing the default `outputDir`, or moving where secrets are expected to live. Relocating the artifact directory is a bigger UX decision.
- The `.env.example` generation (`buildEnvExample`) or its contents.
- The root `.gitignore` of the user's project. Init writes only inside the directory it owns.
- `apps/cli/src/introspect.ts`. Making `introspect --out` write the same file is a reasonable follow-up but doubles the surface under test here.
- Any secret scanning, detection, or rotation tooling.

## Git workflow

- Branch: `advisor/043-init-writes-artifact-gitignore`
- Commit message style e.g. `feat(cli): write a .gitignore into the schema artifact dir`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Write the `.gitignore` in `finishInit`

Immediately after the `.env.example` block (ending at line 1006), add an equivalent block for the artifact directory. It must:

- Resolve the target as `join(dirname(configTarget), answers.schemaOut)` — the artifact path is relative to the config file, matching how `introspection.outputDir` is interpreted.
- Create the directory with `mkdirSync(dir, { recursive: true })`. At init time it does not exist yet; the first `introspect --out` run creates it. Creating it early is what lets the ignore rules exist *before* anything is written into it.
- Skip entirely if `<dir>/.gitignore` already exists — never overwrite a user's file.
- Be non-fatal on error, matching the `.env.example` block's `catch {}`.
- Echo the written path in the same `  - <path>` format.

The file contents:

```
# Written by `askdb init`.
#
# The schema artifact in this directory is meant to be committed — schema.json
# plus any enrichment you author in Studio. Credentials are not: keep API keys
# and connection strings out of version control even when they live here.
.env
.env.*
!.env.example
```

`.env.*` with a `!.env.example` negation covers `.env.local`, `.env.production` and similar variants while keeping a shareable template committable.

Guard against one edge case: if `answers.schemaOut` resolves to the same directory as the config file, do **not** write this file — it would add `.env` ignore rules to the user's project root, which is beyond what init should decide. Skip silently in that case.

**Verify**: `pnpm --filter askdb lint && pnpm --filter askdb build` → exit 0.

### Step 2: Tests

Add to the CLI's init test file, following the structure of the existing tests that assert on written files (find them with `grep -n "env.example" apps/cli/src/*.test.ts`). Each case should run init into a temporary directory.

1. Init writes `<schemaOut>/.gitignore`, and its contents include `.env`, `.env.*`, and `!.env.example`.
2. Init creates `<schemaOut>/` when it does not already exist.
3. An existing `<schemaOut>/.gitignore` is **not** overwritten — pre-create one with sentinel content and assert the content is unchanged afterwards.
4. When `schemaOut` resolves to the config's own directory, no `.gitignore` is written there.
5. A failure to write the `.gitignore` (simulate with a read-only directory, or whatever mechanism the existing tests use for filesystem failures) does not fail init — the exit code stays 0 and the config is still written.

Case 5 matters: init succeeding is more important than this defensive file.

**Verify**: `pnpm --filter askdb test` → all pass, 5 new cases.

### Step 3: Changeset and full gate

Create `.changeset/init-artifact-gitignore.md` — **patch** bump for `askdb`. Body: `askdb init` now writes a `.gitignore` into the schema artifact directory that ignores `.env` files while keeping the artifact itself committable; existing files are never overwritten.

**Verify**: `pnpm build && pnpm lint && pnpm test` → all exit 0.

## Test plan

- Five cases in the CLI init test file per Step 2, each operating in a temporary directory so no repository file is touched.
- Case 3 (never overwrite) and case 5 (non-fatal) are the two that protect users; make sure both are present.
- Verification: `pnpm --filter askdb test` → all pass.

## Done criteria

ALL must hold:

- [ ] `pnpm build` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `pnpm test` exits 0 with 5 new CLI init test cases
- [ ] Running init in a temporary directory produces `<schemaOut>/.gitignore` containing `.env`, `.env.*`, and `!.env.example`
- [ ] Re-running init over an existing `<schemaOut>/.gitignore` leaves it byte-identical
- [ ] `git diff --name-only apps/cli/src/introspect.ts` is empty (out-of-scope file untouched)
- [ ] No credential value appears anywhere in the diff or in the test fixtures
- [ ] `.changeset/init-artifact-gitignore.md` exists
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `answers.schemaOut` turns out to be an absolute path, or to escape the project directory (`../…`). Writing a `.gitignore` outside the project is not acceptable; report the case rather than guessing at a containment rule.
- Creating the artifact directory at init time breaks an existing init test — that would mean something depends on the directory not existing yet.
- You cannot write case 5 (non-fatal write failure) with the test helpers this repo already uses. Ship cases 1–4 and report the gap rather than inventing a new filesystem-mocking approach.
- You encounter an actual credential in a fixture or test file. Report its `file:line` and the credential type only — never the value — and recommend rotation.

## Maintenance notes

- **`askdb introspect --out <dir>` should do the same thing** for users who never ran `init`, or who point introspection at a new directory later. Deliberately deferred to keep this diff small; it is the obvious follow-up and reuses the same helper.
- If the default `outputDir` ever changes, this code follows `answers.schemaOut` automatically — but the skip-if-same-as-config-dir guard in Step 1 should be re-checked.
- This is a defense-in-depth measure, not a guarantee. It does nothing for a repository whose secrets are already committed. Anyone reviewing this change should keep secret scanning in CI on the roadmap as the actual control.
- **Reviewer focus**: confirm the existing-file check happens before the write, and that a write failure cannot change init's exit code.
