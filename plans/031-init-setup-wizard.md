# Plan 031: Make `askdb init` a setup wizard that writes a tailored config and installs selected packages

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat 7152dec..HEAD -- apps/cli/src/init.ts apps/cli/src/init.test.ts apps/cli/src/cli.ts apps/cli/README.md apps/cli/package.json apps/docs-site/src/content/docs/quickstart.mdx apps/docs-site/src/content/docs/reference/cli.mdx packages/config/src/types.ts packages/config/src/runtime-config.ts packages/config/src/flatten.ts plans/030-studio-multi-dialect-execute.md
> ```
>
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/030-studio-multi-dialect-execute.md`
- **Category**: dx
- **Planned at**: commit `7152dec`, 2026-06-25

## Why this matters

`askdb init` currently gives every user the same large Postgres/OpenAI/file-RAG template, even when they are setting up SQL Server, SQLite, Prisma, or a non-OpenAI provider. That forces users to delete unrelated config branches, guess which driver package to install, and then discover missing peer dependencies later in `introspect` or Studio execute. A wizard can turn setup into one coherent flow: ask what the user is doing, write only the relevant config properties, and install the exact packages needed for that chosen path.

This should remain automation-friendly. CI and docs scripts must be able to run `askdb init` without hanging on prompts.

## Current state

- `apps/cli/src/cli.ts` special-cases `init` before config bootstrap, then delegates directly to `runInitCli`.

```ts
// apps/cli/src/cli.ts:33
// `askdb init` writes templates and should not require a valid askdb.config.
if (process.argv[2] !== "init") {
  bootstrapAskDbEnv({ cwd: process.cwd() });
}

if (process.argv[2] === "init") {
  process.exit(runInitCli(process.argv.slice(3)));
}
```

- `apps/cli/src/init.ts` contains one fixed template string with all major branches included, regardless of user intent.

```ts
// apps/cli/src/init.ts:9
/** Single template: only `askdb.config.ts` is written (kept in sync with the repo root `askdb.config.ts`). */
const CONFIG_TEMPLATE = `import dotenv from "dotenv";
import { defineConfig, env, type AskDbConfig } from "@askdb/config";
...
  introspection: {
    // postgres | prisma | mysql | sqlite | sqlserver
    provider: "postgres",
    providerConfig: {
      postgres: {
        // Postgres URL for \`askdb introspect\` — maps to ASKDB_INTROSPECT_POSTGRES_URL
        databaseUrl: env("DATABASE_URL"),
      },
    },
...
  studio: {
    listen: {
      host: env("ASKDB_STUDIO_HOST"),
      ...(env("ASKDB_STUDIO_PORT") ? { port: Number(env("ASKDB_STUDIO_PORT")) } : {}),
    },
    execute: {
      // Connection URL for the Studio playground query runner (maps to ASKDB_STUDIO_DATABASE_URL)
      databaseUrl: env("DATABASE_URL"),
    },
  },
} satisfies AskDbConfig);
`;
```

- `apps/cli/src/init.ts` installs only `@askdb/config` and `dotenv`.

```ts
// apps/cli/src/init.ts:135
export type InitDepSpecs = { configSpec: string; dotenvSpec: string };

// apps/cli/src/init.ts:169
function runPackageManagerInstall(pm: PackageManager, packageDir: string, specs: InitDepSpecs): boolean {
  const [c, d] = formatDepArgs(specs);
  ...
  args = ["add", c, d];
  ...
}
```

- `apps/cli/src/init.ts` only supports `--force`, `--path`, and `--skip-install`.

```ts
// apps/cli/src/init.ts:295
function parseOptions(argv: readonly string[]): InitOptions {
  const opts: InitOptions = { force: false, path: DEFAULT_CONFIG_PATH, skipInstall: false };
  ...
  case "--skip-install":
    opts.skipInstall = true;
    break;
  case "--path": {
    ...
  }
```

- Existing tests cover helper functions only; they do not cover config rendering or package selection.

```ts
// apps/cli/src/init.test.ts:12
describe("init helpers", () => {
  it("findNearestPackageJsonDir finds parent package.json", () => {
```

- The docs currently describe `init` as fixed scaffolding plus `@askdb/config` / `dotenv` install.

```md
<!-- apps/docs-site/src/content/docs/reference/cli.mdx:28 -->
Scaffolds `askdb.config.ts` (and adds `@askdb/config` + `dotenv` to your project) so the rest of the CLI can resolve config.
```

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| CLI tests | `pnpm -C apps/cli test -- src/init.test.ts` | exit 0, all init tests pass |
| CLI typecheck | `pnpm -C apps/cli lint` | exit 0, no TypeScript errors |
| Docs build | `pnpm docs:build` | exit 0 |
| Full tests | `pnpm test` | exit 0 |
| Smoke install | `pnpm smoke:install` | exit 0 |
| Full lint | `pnpm lint` | exit 0, or only the pre-existing docs-site virtual Starlight import issue noted in prior plan closeouts |

## Scope

**In scope**:

- `apps/cli/src/init.ts`
- `apps/cli/src/init.test.ts`
- `apps/cli/src/cli.ts`
- `apps/cli/README.md`
- `apps/cli/package.json`
- `pnpm-lock.yaml`, only if package metadata changes require it
- `apps/docs-site/src/content/docs/quickstart.mdx`
- `apps/docs-site/src/content/docs/reference/cli.mdx`
- `apps/docs-site/src/content/docs/reference/packages.mdx`, only if package-selection docs need a central reference update
- `.changeset/*.md`
- `plans/README.md`

**Out of scope**:

- Do not implement Studio multi-dialect execute here; that belongs to plan 030.
- Do not change connector internals or introspection behavior.
- Do not create `.env` with real secrets.
- Do not add a broad app/plugin installer beyond the packages needed by the selected AskDB setup.
- Do not change `AskDbConfig` shape except for fields already introduced by plan 030. If plan 030 has not landed, stop.

## Git workflow

- Stay on the current branch unless the operator directs otherwise.
- Match the repo's conventional commit style, e.g. `fix(cli): resolve optional database drivers from project`.
- Add a Changeset entry for `askdb` and docs-facing package changes.

## UX Contract

### Interactive behavior

When `askdb init` runs in an interactive TTY and the user did not pass `--yes` / `--no-interactive`, open a wizard using `@inquirer/prompts`.

Use the modern modular package, not the older monolithic `inquirer` package. Keep it behind a small adapter so prompt UI stays separate from init's business logic:

```ts
type InitPrompter = {
  select<T extends string>(opts: {
    message: string;
    choices: Array<{ name: string; value: T }>;
    default?: T;
  }): Promise<T>;
  input(opts: {
    message: string;
    default?: string;
    validate?: (value: string) => true | string;
  }): Promise<string>;
  confirm(opts: {
    message: string;
    default?: boolean;
  }): Promise<boolean>;
};
```

Implementation requirements:

- Lazy-import `@inquirer/prompts` only when entering interactive mode.
- Do not import it for `--yes`, `--no-interactive`, `--help`, or non-TTY default runs.
- Keep `resolveDefaultInitAnswers`, `renderInitConfig`, and `buildInitInstallPlan` pure and independent of Inquirer.
- Use a fake `InitPrompter` in tests instead of trying to drive terminal input.
- Treat prompt cancellation as a clean user abort: print a short message and exit 1 without writing files.

Wizard questions:

1. **Database source**
   - Choices: `postgres`, `mysql`, `sqlite`, `sqlserver`, `prisma`
   - Default: `postgres`
2. **Connection variable/path**
   - For Postgres/MySQL/SQL Server: ask for the env var name that holds the connection URL.
   - Default: `DATABASE_URL` for Postgres/MySQL, `SQLSERVER_URL` for SQL Server.
   - For SQLite: ask for either a literal file path or env var name. Prefer env var name in generated config unless the user explicitly enters a relative path.
   - For Prisma: ask for schema path, default `./prisma/schema.prisma`.
3. **Schema output directory**
   - Default: `./askdb`
4. **AI provider**
   - Choices: `openai`, `anthropic`, `google`, `azure`, `foundry`
   - Default: `openai`
   - Ask for API key env var name. Defaults:
     - OpenAI: `OPENAI_API_KEY`
     - Anthropic: `ANTHROPIC_API_KEY`
     - Google: `GOOGLE_GENERATIVE_AI_API_KEY`
     - Azure/Foundry: `AZURE_OPENAI_API_KEY`
   - Ask for optional model env var name. Defaults:
     - OpenAI: `OPENAI_MODEL`
     - Anthropic: `ANTHROPIC_MODEL`
     - Google: `GOOGLE_GENERATIVE_AI_MODEL`
     - Azure/Foundry: `AZURE_OPENAI_DEPLOYMENT`
5. **RAG setup**
   - Choices: `file`, `memory`, `pgvector`
   - Default: `file`
   - If `pgvector`, ask for `ASKDB_PGVECTOR_URL`.
6. **Studio execute**
   - Ask whether to enable Studio's execute button.
   - Default: `no` for Prisma, `yes` for live databases.
   - If enabled, use the same provider/connection as introspection by default.
   - If the user selected Prisma, allow execute only if they choose a live provider and connection env var.

Before writing files or installing packages, print a concise summary:

- Config path
- Database source/provider
- AI provider
- RAG store
- Studio execute enabled/disabled
- Packages that will be installed

Then ask for confirmation. If the user says no, exit 1 without writing.

### Non-interactive behavior

`askdb init` must never hang in non-TTY environments.

Add options:

- `--yes`: accept defaults and do not prompt.
- `--interactive`: force the wizard; error if stdin/stdout are not TTYs.
- `--no-interactive`: do not prompt.
- `--database <postgres|mysql|sqlite|sqlserver|prisma>`
- `--connection-env <name>` for URL-based live databases.
- `--sqlite-file <path-or-env>` for SQLite.
- `--prisma-schema <path>` for Prisma.
- `--schema-out <dir>`
- `--ai-provider <openai|anthropic|google|azure|foundry>`
- `--ai-key-env <name>`
- `--ai-model-env <name>`
- `--rag-store <file|memory|pgvector>`
- `--pgvector-env <name>`
- `--studio-execute`
- `--no-studio-execute`
- Keep existing `--force`, `--path`, and `--skip-install`.

Default non-interactive answers should match a reasonable minimal setup:

- database: `postgres`
- connection env: `DATABASE_URL`
- schema out: `./askdb`
- AI provider: `openai`
- AI key env: `OPENAI_API_KEY`
- AI model env: `OPENAI_MODEL`
- RAG store: `file`
- Studio execute: `false` unless `--studio-execute` is passed

This preserves automation safety while nudging humans into the wizard.

## Package Selection Contract

Build an explicit install plan from answers.

Always install:

- `@askdb/config`
- `dotenv`

Install live driver packages when needed:

- Postgres introspection or Studio execute: `pg`
- MySQL introspection or Studio execute: `mysql2`
- SQLite introspection or Studio execute: `better-sqlite3`
- SQL Server introspection or Studio execute: `mssql`
- Prisma introspection only: no live DB driver

Do not install all drivers. The point is to install exactly the selected path's optional peers.

If the user enables Studio execute for a live provider, make sure that provider's driver is in the install plan even if it was not needed for introspection. Example: Prisma introspection + SQL Server Studio execute installs `mssql`.

Keep the current workspace-root guard:

- If no `package.json` exists, write the config and print the exact install command.
- If the nearest package is a workspace root, write the config and print the exact command to run in the app package.
- Otherwise install with the detected package manager.

## Config Rendering Contract

Replace the fixed `CONFIG_TEMPLATE` with a renderer:

```ts
export type InitAnswers = {
  database: "postgres" | "mysql" | "sqlite" | "sqlserver" | "prisma";
  connectionEnv?: string;
  sqliteFile?: string;
  prismaSchema?: string;
  schemaOut: string;
  aiProvider: "openai" | "anthropic" | "google" | "azure" | "foundry";
  aiKeyEnv: string;
  aiModelEnv?: string;
  ragStore: "file" | "memory" | "pgvector";
  pgvectorEnv?: string;
  studioExecute:
    | { enabled: false }
    | {
        enabled: true;
        provider: "postgres" | "mysql" | "sqlite" | "sqlserver";
        connectionEnv?: string;
        sqliteFile?: string;
      };
};

export function renderInitConfig(answers: InitAnswers): string;
```

Generated config rules:

- Include only the selected `introspection.providerConfig` branch.
- Include only the selected AI `providerConfig` branch.
- Include only the selected RAG `storeConfig` branch.
- Include `studio.execute` only when enabled.
- Include `studio.execute.provider` and SQLite `file` only after plan 030 has landed.
- Keep `satisfies AskDbConfig`.
- Keep `dotenv.config({ quiet: true })`.
- Use `env("...")` for secret-bearing values; never inline secret values.
- Keep comments short and specific to the generated branch.

Examples:

Postgres + OpenAI + file RAG + no execute:

```ts
import dotenv from "dotenv";
import { defineConfig, env, type AskDbConfig } from "@askdb/config";

dotenv.config({ quiet: true });

export default defineConfig({
  ai: {
    provider: "openai",
    providerConfig: {
      openai: {
        apiKey: env("OPENAI_API_KEY"),
        model: env("OPENAI_MODEL"),
      },
    },
  },
  introspection: {
    provider: "postgres",
    providerConfig: {
      postgres: {
        databaseUrl: env("DATABASE_URL"),
      },
    },
    outputDir: "./askdb",
  },
  rag: {
    embedder: "mock",
    embedderConfig: {},
    store: "file",
    storeConfig: {
      file: {},
    },
  },
} satisfies AskDbConfig);
```

SQL Server + OpenAI + file RAG + Studio execute:

```ts
studio: {
  execute: {
    provider: "sqlserver",
    databaseUrl: env("SQLSERVER_URL"),
  },
},
```

SQLite should use the file field introduced by plan 030 for Studio execute:

```ts
introspection: {
  provider: "sqlite",
  providerConfig: {
    sqlite: {
      file: env("SQLITE_FILE"),
    },
  },
  outputDir: "./askdb",
},
studio: {
  execute: {
    provider: "sqlite",
    file: env("SQLITE_FILE"),
  },
},
```

## Steps

### Step 1: Refactor `init` around pure answer, render, and install-plan helpers

In `apps/cli/src/init.ts`:

- Replace `CONFIG_TEMPLATE` with `renderInitConfig(answers)`.
- Add `resolveDefaultInitAnswers(overrides)` for non-interactive defaults.
- Add `buildInitInstallPlan(answers, specs)` returning package specs and user-facing labels.
- Generalize `runPackageManagerInstall` and `formatManualInstallCommand` to accept a package list, not only `@askdb/config` / `dotenv`.
- Keep `findNearestPackageJsonDir`, `isLikelyWorkspaceRoot`, and `detectPackageManager` behavior.

Use small string-builder helpers rather than a monolithic template where possible. Keep output deterministic for snapshot-like tests.

**Verify**:

```bash
pnpm -C apps/cli test -- src/init.test.ts
```

Expected at this point: existing tests pass or fail only because new tests have not been added yet. Do not proceed with TypeScript errors.

### Step 2: Add option parsing for interactive and non-interactive init

Extend `InitOptions` and `parseOptions` in `apps/cli/src/init.ts`.

Required behavior:

- Existing flags continue to work.
- Unknown options still return a clear error.
- `--interactive` and `--no-interactive` conflict.
- `--yes` and `--interactive` conflict.
- `--studio-execute` and `--no-studio-execute` conflict.
- Invalid enum values return clear errors listing allowed values.

Update the Commander registration in `apps/cli/src/cli.ts` so `askdb init --help` lists the new flags.

**Verify**:

```bash
pnpm -C apps/cli lint
```

Expected: exit 0.

### Step 3: Implement the TTY wizard

In `apps/cli/src/init.ts`, add an internal wizard using a lazy-loaded `@inquirer/prompts` adapter.

Implementation notes:

- Do not prompt unless interactive mode is active.
- Keep prompt copy short.
- Provide defaults in the prompt text.
- Validate env var names with a conservative pattern like `/^[A-Z_][A-Z0-9_]*$/i`; allow relative paths for SQLite/Prisma fields.
- Do not ask users to paste actual API keys or connection strings.
- Add an injectable prompt dependency for tests; do not drive a real terminal in tests.
- If `@inquirer/prompts` throws because the user cancelled, return a clear abort result and avoid writing config/installing packages.

**Verify**:

```bash
pnpm -C apps/cli lint
```

Expected: exit 0.

### Step 4: Wire `runInitCli` to choose wizard vs defaults safely

Update `runInitCli(argv)`:

- Parse options.
- If `--help`, print help and exit 0.
- If config target exists and no `--force`, preserve current refusal behavior before prompting.
- Determine interactive mode:
  - `--interactive`: require TTY.
  - `--no-interactive` or `--yes`: use defaults/flags.
  - no flag: use wizard only when stdin and stdout are TTYs; otherwise use defaults/flags.
- Build answers.
- Print summary and confirm only in interactive mode.
- Write rendered config.
- Install selected packages unless `--skip-install`.
- Print next steps based on selected answers.

Next steps should be specific:

- Live database: `askdb introspect`
- Prisma: `askdb introspect`
- Studio enabled: `askdb studio`
- Ask: `askdb ask --question "..."`

Do not tell SQL Server users to install `pg`.

**Verify**:

```bash
pnpm -C apps/cli test -- src/init.test.ts
```

Expected: exit 0 after tests from the next step are added.

### Step 5: Add focused tests

Extend `apps/cli/src/init.test.ts`.

Add tests for:

- `renderInitConfig` emits only the Postgres branch for Postgres answers.
- `renderInitConfig` emits only the SQL Server branch and `studio.execute.provider = "sqlserver"` when execute is enabled.
- `renderInitConfig` emits SQLite `file` fields for introspection and Studio execute.
- `renderInitConfig` emits Prisma `schemaPath` and does not install a live driver unless Studio execute is enabled.
- `buildInitInstallPlan` includes `mssql` for SQL Server.
- `buildInitInstallPlan` includes `better-sqlite3` for SQLite.
- `buildInitInstallPlan` includes `mssql` for Prisma + SQL Server execute.
- `buildInitInstallPlan` does not include unrelated drivers.
- Option parser rejects invalid database/provider values.
- Non-interactive defaults produce Postgres/OpenAI/file-RAG/no-execute.
- `--skip-install` still writes config without invoking the installer. Use an injected installer or exported pure helper; do not run a real package manager in tests.

Use the existing temporary-directory pattern in `apps/cli/src/init.test.ts`.

**Verify**:

```bash
pnpm -C apps/cli test -- src/init.test.ts
```

Expected: all init tests pass, including the new cases.

### Step 6: Update docs

Update:

- `apps/cli/README.md`
- `apps/docs-site/src/content/docs/quickstart.mdx`
- `apps/docs-site/src/content/docs/reference/cli.mdx`
- `apps/docs-site/src/content/docs/reference/packages.mdx` if needed

Docs should show:

- `npx askdb@latest init` starts a wizard in a terminal.
- `npx askdb@latest init --yes` is the non-interactive default.
- Example SQL Server setup no longer requires hand-editing a Postgres config.
- The wizard installs selected optional peer drivers, but only for selected features.
- Studio execute package installation only appears when the user enables Studio execute.

Keep examples concise. The quickstart should not list every flag; put the flag table in the CLI reference.

**Verify**:

```bash
pnpm docs:build
```

Expected: exit 0.

### Step 7: Add package metadata and changeset updates

Add `@inquirer/prompts` to `apps/cli/package.json` dependencies, update the lockfile, and mention in the changeset that it is lazy-loaded only for interactive `askdb init`.

Add a Changeset for:

- `askdb`: minor or patch depending on release policy; this is user-visible CLI behavior, so minor is reasonable.
- Docs packages only if this repo's release policy requires docs-site changesets.

**Verify**:

```bash
pnpm -C apps/cli lint
pnpm -C apps/cli test -- src/init.test.ts
pnpm docs:build
```

Expected: all exit 0.

## Test plan

New tests live in `apps/cli/src/init.test.ts`.

Use pure helper tests for most behavior:

- `renderInitConfig`
- `buildInitInstallPlan`
- option parsing / defaults
- no unrelated branches in rendered config

Use a small integration-style test for `runInitCli` with `--yes --skip-install --path <tmpfile>`:

- Assert exit 0.
- Assert the file exists.
- Assert it includes only the default Postgres branch.

Do not spawn real package managers in unit tests.

## Done criteria

All must hold:

- [ ] `askdb init` opens a wizard only in interactive TTY mode.
- [ ] `askdb init --yes --skip-install` completes without prompts.
- [ ] Generated config includes only selected provider branches.
- [ ] SQL Server setup installs/selects `mssql`, not `pg`.
- [ ] SQLite setup uses `better-sqlite3` and file config, not `DATABASE_URL`.
- [ ] Prisma setup does not install a live driver unless Studio execute is enabled.
- [ ] Studio execute install choices line up with the provider model from plan 030.
- [ ] `pnpm -C apps/cli test -- src/init.test.ts` exits 0.
- [ ] `pnpm -C apps/cli lint` exits 0.
- [ ] `pnpm docs:build` exits 0.
- [ ] `pnpm smoke:install` exits 0.
- [ ] `plans/README.md` row for plan 031 is updated by the executor.

## STOP conditions

Stop and report if:

- Plan 030 has not landed and `AskDbConfig["studio"]["execute"]` still cannot represent provider-specific execute settings.
- `@inquirer/prompts` cannot be lazy-loaded cleanly from the published ESM CLI.
- The generated minimal config cannot satisfy `AskDbConfig` without including unrelated branches.
- Tests require running real package-manager installs.
- The implementation would need to write real secrets into `.env`.
- Existing non-interactive `askdb init` users would hang or be forced through prompts.

## Maintenance notes

- When new database engines are added, update the wizard choices, install-plan map, and config renderer together.
- When new AI providers are added, update provider defaults and docs in one PR.
- Keep the wizard's package map aligned with optional peer declarations in the connector and Studio packages.
- Reviewers should scrutinize shell safety: package names must come from allowlisted maps, never raw prompt input.
