# Spec: Test campaign — cli (#520)

## For the owner

This spec applies the `cli` test campaign's plan to `apps/cli`'s tests: 3 of the 4 weak tests are repaired so they can fail for the regression they name, 10 duplicate tests are deleted after their unique assertions move into the test that keeps the contract, and no production code changes. The fourth weak test, `resolveInitDepSpecs`, moves to #525 with the bug it exposed.

| Decision | Answer | Settled by | Undo |
|---|---|---|---|
| What changes | The issue's ledger: 10 C rows folded into their keepers, 0 D rows, and the F rows repaired, all but one (next row) | Triage (#520 Triage comment, from the campaign plan in the issue body) | two-way: revert |
| The `resolveInitDepSpecs` F row | Dropped from this ticket: the test stays as it is. The bug (`require.resolve("@askdb/config/package.json")` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`, so `configSpec` is `"latest"` in the monorepo) and its pinning test are #525 | Owner, option A of the align escalation (delegation of 2026-10-25) | two-way |
| Plan size | The whole plan, including the per-provider table in the `renderInitConfig` tests; the plan's "drop it if over budget" fallback does not apply | Triage (standard lane, so the quick budget no longer caps the diff) | two-way |
| Test-only production seams | All kept: `runInitCli`'s installer argument, `connectorRegistry`, the test-only `init.ts` exports, `defaultConnectorRegistry` | Triage (campaign plan, "Test-only production seams") | two-way |
| The 4 possible product bugs in the issue | Out of scope; file separately if wanted | Triage (Out of scope) | two-way |
| Production code and changeset | None: test files only, so no changeset | Triage (acceptance criteria) | two-way |

No defaults: triage took none, and the grill stage closed with nothing to settle.

```text
DELETE (C)                                            KEEPER (gains)
init  renderInitConfig > Postgres ...              -> runInitCli "writes config with default Postgres branch"  (+databaseUrl, +no studio:)
init  renderInitConfig > Anthropic ...             -> [per-provider ai table]  (rebuilt from the azure/foundry it.each)
init  renderInitConfig > non-Azure no resourceName -> [per-provider ai table]
init  buildInitInstallPlan > includes pg           -> "base packages always included"  (+pg)
init  resolveDefaultInitAnswers > database override-> runInitCli "respects --database sqlserver flag"  (+databaseUrl)
shim  templates via Postgres connector             -> spawn-first-run "askdb introspect templates --engine postgres" row
shim  templates rejected for Prisma                -> introspect-registry "keeps the `introspect templates` message ..."
shim  prints Schema v2 JSON from Prisma            -> shim "--diff reports unchanged against an artifact written by --out ..."
shim  writes schema to --out for Prisma            -> shim "supports Prisma diff and out modes"
rag   rejects --api-key (space form)               -> rag "never repeats %s in its error" --api-key=value row

REPAIR (F)
init  rejects unknown flags                  + stderr has "Unknown option: --nonexistent-flag"
registry  explicit --url ...                 + resolveConnection got explicit.url "acme://flag"; renamed
shim  auto-discovers prisma schema or errors + renamed to the error path only

MOVED (unchanged here)
init  resolveInitDepSpecs ...                -> #525 (fix the "latest" fallback, then pin the version)
```

**Risks:** a carried-over assertion lost in a deletion leaves a contract untested; the coverage table below maps each one to its keeper. The table rework is the only rewritten test, and evaluates the rendered config, so a wrong expectation fails loudly.

**Done when:** every ledger row is applied as above (the `resolveInitDepSpecs` row left to #525), `pnpm test` passes for `apps/cli` and `pnpm lint` passes, with no change outside `apps/cli`'s test files.

**Needs you:** nothing. The one open decision, what to do about `resolveInitDepSpecs` returning `"latest"` in the monorepo, was settled as option A (see the table) and the bug is filed as #525.

Reply: `/approve` · `/changes <guidance>`

## Problem Statement

The weekly test campaign audited `apps/cli`'s 130 tests read-only. Most are right, but 10 duplicate a stronger test that already proves the same contract, and 4 cannot fail for the regression their names promise: one passes for an unrelated reason, one asserts something that always holds, one asserts its own mock's behavior, and one is named for a path it never runs. A maintainer reading or changing the CLI's tests pays for the duplicates, and trusts four tests that would stay green through the bugs they claim to catch.

## Solution

Apply the campaign's plan, recorded in the issue body (`Ledger rows`, `Retire`, `Carry-over assertions`, `F repairs`), which triage verified. Each duplicate is deleted once whatever it asserted that its keeper does not is added to the keeper. Each weak test keeps its contract and gains the assertion that makes it fail on its named regression, or a name that matches what it runs. The suite stays green and behavior does not change.

## User Stories

1. As a maintainer, I want `askdb init`'s unknown-flag test to check the parser's message, so that it fails if unknown flags stop being rejected instead of passing because a later install step also returns 1.
2. As a maintainer, I want the registry's `--url` test to assert what the CLI forwards to the adapter, so that it tests the CLI rather than the precedence its own mock implements.
3. As a maintainer, I want the Prisma error-path test named for what it runs, so that nobody believes auto-discovery success is covered here.
4. As a maintainer, I want one table over every AI provider in the `renderInitConfig` tests, so that each provider's `providerConfig` shape (and `resourceName` only for azure and foundry) is checked on the evaluated config, not by substring.
5. As a maintainer, I want the default Postgres `askdb init` test to also check `databaseUrl` and the absence of a `studio:` section, so that deleting the `renderInitConfig` Postgres test loses no assertion.
6. As a maintainer, I want the `--database sqlserver` init test to also check `databaseUrl: env("DATABASE_URL")`, so that the connection-env default stays covered after the `resolveDefaultInitAnswers` override test goes.
7. As a maintainer, I want the base install-plan test to also check `pg`, so that the identical "includes pg for postgres" test can go.
8. As a maintainer, I want the duplicated spawned `introspect` tests removed, so that the slow spawned suite runs each command once.
9. As a maintainer, I want the duplicated `--api-key` rejection test removed, so that the rejection is pinned once, in the table that checks no argv secret is echoed.
10. As a reviewer, I want each deletion to point to its keeper, so that I can check no contract lost its only test.
11. As a release owner, I want the change confined to test files, so that it needs no changeset and cannot change the published `askdb` binary.

## Implementation Decisions

The plan's rows name tests by file and title, so this section does too; the files are all under `apps/cli`'s source folder.

**C rows: delete, after carrying assertions into the keeper.**

- `init.test.ts`, `renderInitConfig > Postgres: only postgres branch in introspection`: delete. Its keeper, `runInitCli --yes --skip-install > writes config with default Postgres branch`, gains `toContain('databaseUrl: env("DATABASE_URL")')` and `not.toContain("studio:")`.
- `init.test.ts`, `renderInitConfig > Anthropic AI provider: only anthropic branch`, and `renderInitConfig > non-Azure AI providers: no resourceName line`: delete both. Their keeper is the per-provider table below.
- `init.test.ts`, `buildInitInstallPlan > includes pg for postgres`: delete. `buildInitInstallPlan > base packages always included` (same inputs) gains `expect(plan.packages).toContain("pg")`.
- `init.test.ts`, `resolveDefaultInitAnswers > respects database override`: delete. `runInitCli --yes --skip-install > respects --database sqlserver flag` gains `toContain('databaseUrl: env("DATABASE_URL")')`.
- `introspect-shim.test.ts`, `runs \`askdb introspect templates\` via the in-tree Postgres connector`: delete. Its keeper is spawn-first-run's `askdb ["introspect","templates","--engine","postgres"]` row (exit 0, empty stderr, `-- schemas`).
- `introspect-shim.test.ts`, `rejects \`introspect templates\` for Prisma, which provides no SQL templates`: delete. The exact message is pinned in-process by introspect-registry's `keeps the \`introspect templates\` message naming postgres for the built-in registry`; spawned exit-code propagation stays covered by the shim's other failing commands.
- `introspect-shim.test.ts`, `prints Schema v2 JSON from a Prisma schema file`: delete. Its keeper, `--diff reports unchanged against an artifact written by --out from the same source`, runs the same `--print --schema-id simple` command and checks more.
- `introspect-shim.test.ts`, `writes schema to --out directory for Prisma introspection`: delete. Its keeper, `supports Prisma diff and out modes`, runs the same `--out` command with the same assertion.
- `rag.test.ts`, `rejects --api-key: keys come from ai.providerConfig, never argv`: delete. Its keeper is the `--api-key=value` row of the `never repeats %s in its error` table: same branch, byte-identical stderr.

**The per-provider table.** The `renderInitConfig` azure/foundry `it.each` becomes a table with one row each for openai, anthropic, google, azure and foundry. Each row sets `aiProvider`, `aiKeyEnv` and `aiModelEnv`, renders, evaluates the rendered config as the current `it.each` does, and expects:

- `ai.provider` equals the row's provider;
- `ai.providerConfig` equals `{ [provider]: { apiKey: { env: <aiKeyEnv> } } }`, plus `resourceName: { env: "AZURE_RESOURCE_NAME" }` for azure and foundry only;
- `ai.language` equals `{ model: { env: <aiModelEnv> } }`.

The test name keeps saying what azure and foundry get (the `resourceName`) and what the others don't.

**F rows: repair.**

- `init.test.ts`, `option parser > rejects unknown flags`: keep `code === 1` and add that stderr contains `Unknown option: --nonexistent-flag`.
- `init.test.ts`, `init helpers > resolveInitDepSpecs returns non-empty specs`: not changed here. Asserting the version fails against today's `init.ts` (it returns `"latest"` in the monorepo), and this ticket changes no production code, so the repair goes with the fix in #525 (owner, option A).
- `introspect-registry.test.ts`, `lets explicit --url win over the adapter's configured fallback`: assert the adapter's `resolveConnection` was called with `explicit` containing `url: "acme://flag"`, keep the `createConnector` url check, and rename to "forwards --url to the adapter as explicit.url".
- `introspect-shim.test.ts`, `auto-discovers prisma schema or errors with a helpful message when none is found`: rename to "errors with an auto-discover message when no Prisma schema is found". Its assertions stay.

No production file, no other test file and no fixture changes. No whole test file is removed.

## Testing Decisions

- The changed tests are the deliverable. Each F repair is checked by breaking the behavior it names by hand (accept unknown flags; stop forwarding `--url`) and seeing the test fail, then restoring it. The rename-only F row has no regression to break.
- Each C deletion is checked against the coverage table below: every assertion it made is either in its keeper already or carried there.
- Tests assert what users see: rendered or evaluated config, stderr text, exit codes, what crosses the adapter boundary. None asserts call order or internal helpers beyond what the plan names.
- Prior art: the azure/foundry `it.each` (evaluated config), the spawn-first-run `it.each` (one row per command), and the rag `never repeats %s in its error` table.
- Verification: `pnpm test` (which builds `dist` before the spawned tests) passes for `apps/cli`, and `pnpm lint` passes. `introspect-config-schemas.integration.test.ts` stays skipped without `ASKDB_FIXTURE_HOST`, as at baseline.

## Ticket coverage

| Ticket item | Met by |
|---|---|
| Each F row repaired, and can fail for its named regression | Implementation Decisions, "F rows: repair"; Testing Decisions, first bullet; the `resolveInitDepSpecs` row moved to #525 (decision "The `resolveInitDepSpecs` F row") |
| Each C row consolidated into its keeper with the carried assertions | Implementation Decisions, "C rows" and "The per-provider table" |
| Each D row deleted, its proof still passing | No D rows (ledger: D 0) |
| Each test-only production seam the plan unlocks removed | None unlocked; all kept (decision "Test-only production seams") |
| Tests green with `pnpm test`, `pnpm lint` passes | Testing Decisions, last bullet |
| No production code changes, no changeset (triage) | Decision "Production code and changeset" |
| Row: init Postgres renderInitConfig (C) | C rows, first bullet |
| Row: init Anthropic (C) | C rows; the per-provider table |
| Row: init non-Azure no resourceName (C) | C rows; the per-provider table |
| Row: init includes pg (C) | C rows |
| Row: init respects database override (C) | C rows |
| Row: init rejects unknown flags (F) | F rows |
| Row: init resolveInitDepSpecs (F) | Moved to #525 (decision "The `resolveInitDepSpecs` F row") |
| Row: registry explicit --url (F) | F rows |
| Row: shim templates Postgres (C) | C rows |
| Row: shim templates Prisma (C) | C rows |
| Row: shim Prisma --print (C) | C rows |
| Row: shim auto-discover (F) | F rows |
| Row: shim Prisma --out (C) | C rows |
| Row: rag --api-key (C) | C rows |

## Out of Scope

- The `resolveInitDepSpecs` `"latest"` fallback in the monorepo and the test that pins `@askdb/config`'s version: #525, since the fix touches `apps/cli/src/init.ts` (a sensitive path) and needs a changeset.
- The four possible product bugs the campaign noted: the dead commander `init` action and its second help text, the install helpers duplicated in Studio, the stale comment in `init-help.test.ts`, and stderr replaced without `try/finally` in the init option-parser tests. File them separately if wanted.
- Tests for the install branch of `runInitCli` (success, failure with the manual command, workspace-root skip): a follow-up candidate the plan names.
- Removing any test-only export or seam in `init.ts` or `introspect.ts`.

## Further Notes

- Two assertions go with their deleted tests and are not carried, as the plan's ledger rows say: the shim's Postgres `templates` test also checked `ORDER BY` (the keeper checks `-- schemas`; the templates output is fixed text), and the `renderInitConfig` Postgres test also checked that `sqlite` and `prisma` are absent (the keeper checks `mysql` and `sqlserver`; the plan carries only `databaseUrl` and `studio:`).
- The plan cites line numbers at head `2ff9332c`; this spec names tests by title, so it holds if lines move.
