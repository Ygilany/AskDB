# Plan 034: Dual-publish CJS + ESM so CommonJS applications can `require()` AskDB

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat cc1193a..HEAD -- packages/core packages/config packages/client packages/ai packages/postgres examples/installable-smoke` If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `cc1193a`, 2026-08-05
- **Breaking**: No — purely additive. Existing ESM consumers keep resolving the same `dist/index.js` through the `import` condition.

## Why this matters

Every AskDB library package publishes only an `import` export condition. A real consumer integration (a CommonJS TypeScript backend) could not `require()` or even `import()` `@askdb/core` from its build, because TypeScript rewrites `import()` into `require()` under `module: commonjs`, and `require()` of a package exposing only `import` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`.

That consumer's workaround cost them five files: a `new Function('specifier', 'return import(specifier)')` escape hatch, a lazy-loading runtime wrapper class, threading the loaded module handle through their error-classification function just to run `instanceof`, structurally re-declaring AskDB's result types to avoid importing them, and fabricating fake AskDB classes in their tests.

CommonJS is still the default for a large share of Node backends (NestJS, Express with `ts-node`, anything on `module: commonjs`). Shipping ESM-only turns AskDB from "install and import" into "install and write an adapter layer." This is the single highest-leverage DX fix available.

## Current state

### The export maps today

`packages/core/package.json`:

```json
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
```

`packages/client/package.json`, `packages/ai/package.json`, and `packages/postgres/package.json` have the identical shape (`import` only).

`packages/config/package.json` is different and **currently wrong**:

```json
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
```

It advertises a `require` condition that points at an **ESM** file. On Node 22.0–22.11 `require()` of that file throws `ERR_REQUIRE_ESM`; it only appears to work on Node ≥22.12 via the `require(esm)` feature. `engines.node` is `>=22`, so this is a real failure window that must be fixed by this plan, not preserved.

### Why dual-publishing is safe here

Two things normally block a CommonJS build. Both were checked at `cc1193a`:

- **Top-level `await`** — none. `grep -rn '^await ' packages/{core,client,ai,postgres,config}/src` (excluding tests) returns zero matches.
- **`import.meta`** — exactly one occurrence repo-wide in a library package: `packages/rag/src/cli.ts:398` — `const pkgPath = new URL("../package.json", import.meta.url);` That file backs the `askdb-rag` bin (`packages/rag/package.json` → `"bin": {"askdb-rag": "./bin/askdb-rag.js"}`), not the `.` export, so it is excluded from the CJS build (see Step 5).

### The one genuine hazard

`packages/config/src/load-merge.ts:10`:

```ts
    const mod = await import(href);
```

Under a CommonJS emit, TypeScript rewrites this `import()` into a `require()` call, which breaks loading a user's ESM `askdb.config.mjs`. The surrounding file already uses `jiti` (`packages/config/src/load-merge.ts:1,14,60`) for the synchronous path. Step 6 handles this specific line; do not let a bundler silently downlevel it.

### Build system today

Every package builds with plain `tsc`:

`packages/core/package.json` scripts:

```json
    "build": "tsc -p tsconfig.build.json",
    "lint": "tsc -p tsconfig.build.json --noEmit",
    "test": "vitest run --config ../../vitest.config.ts"
```

`packages/core/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.test.ts", "src/**/*.integration.test.ts"]
}
```

`tsconfig.base.json` sets `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"target": "ES2022"`, `"declaration": true`, `"declarationMap": true`, `"sourceMap": true`, `"isolatedModules": true`.

Source files use explicit `.js` extensions in relative imports (NodeNext convention), e.g. `packages/core/src/ask.ts:2`:

```ts
import type { AskDbLanguageModel } from "./ai/types.js";
```

`turbo.json` declares `build` with `"outputs": ["dist/**"]`.

### Repo conventions to match

- Package manifests keep this key order: name, version, description, keywords, homepage, bugs, repository, license, author, type, main, types, exports, files, engines, scripts, dependencies, peerDependencies, devDependencies. Match it exactly — see `packages/core/package.json`.
- `"files"` arrays are `["dist", "README.md", "LICENSE", "NOTICE"]`.
- Changesets live in `.changeset/*.md`. See any existing file for the format.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Build all | `pnpm build` | exit 0 |
| Build one | `pnpm --filter @askdb/core build` | exit 0 |
| Typecheck (lint) | `pnpm lint` | exit 0, no errors |
| Tests | `pnpm test` | all pass |
| Install smoke | `pnpm smoke:install` | exit 0 |

## Scope

**In scope**:
- `packages/core/package.json`, `packages/core/tsconfig.build.cjs.json` (create)
- `packages/config/package.json`, `packages/config/tsconfig.build.cjs.json` (create)
- `packages/client/package.json`, `packages/client/tsconfig.build.cjs.json` (create)
- `packages/ai/package.json`, `packages/ai/tsconfig.build.cjs.json` (create)
- `packages/postgres/package.json`, `packages/postgres/tsconfig.build.cjs.json` (create)
- `packages/config/src/load-merge.ts` (one targeted change, Step 6)
- `scripts/write-cjs-marker.mjs` (create)
- `examples/installable-smoke/consumer-cjs/**` (create)
- `examples/installable-smoke/run.sh`
- `.changeset/dual-publish-cjs-esm.md` (create)

**Out of scope** (do NOT touch):
- `packages/rag`, `packages/introspect`, `packages/enrich`, `packages/mysql`, `packages/sqlite`, `packages/sqlserver`, `packages/prisma`, `packages/connectors` — these get the same treatment in a follow-up once the five pilot packages prove the pattern. Widening now makes the diff unreviewable.
- `packages/ai-openai`, `packages/ai-azure`, `packages/ai-google`, `packages/ai-anthropic` — plan 041 restructures these; dual-publishing them first would create a merge conflict for no benefit.
- `apps/**` — the CLI, HTTP API, and Studio are ESM applications, not published libraries. They are unaffected.
- Any change to runtime behavior, exported symbols, or function signatures. This plan changes packaging only.

## Git workflow

- Branch: `advisor/034-dual-publish-cjs-esm`
- Commit per step; message style matches recent history, e.g. `build(core): emit a CommonJS build alongside ESM`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the CJS marker script

Create `scripts/write-cjs-marker.mjs`. Node decides a `.js` file's module format from the nearest `package.json`'s `"type"`. Because each package is `"type": "module"`, the CJS output directory needs its own marker declaring `"type": "commonjs"`.

```js
#!/usr/bin/env node
// Writes the `{"type":"commonjs"}` marker into a CJS output directory so Node
// treats its .js files as CommonJS even though the package is "type": "module".
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve(process.argv[2] ?? "dist/cjs");
mkdirSync(target, { recursive: true });
writeFileSync(resolve(target, "package.json"), `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);
```

**Verify**: `node scripts/write-cjs-marker.mjs /tmp/askdb-cjs-marker-test && cat /tmp/askdb-cjs-marker-test/package.json` → prints `{ "type": "commonjs" }`. Then `rm -rf /tmp/askdb-cjs-marker-test`.

### Step 2: Pilot the dual build on `@askdb/core`

Create `packages/core/tsconfig.build.cjs.json`:

```json
{
  "extends": "./tsconfig.build.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "Node10",
    "outDir": "./dist/cjs",
    "declaration": false,
    "declarationMap": false,
    "noEmit": false
  }
}
```

`declaration: false` is deliberate — the ESM build already emits `.d.ts`, and one set of type declarations serves both conditions. `moduleResolution: Node10` is required because `NodeNext` forbids `module: CommonJS`.

Update `packages/core/package.json`'s `exports`, `main`, and `build` script:

```json
  "main": "./dist/cjs/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/cjs/index.js",
      "default": "./dist/index.js"
    }
  },
```

and:

```json
    "build": "tsc -p tsconfig.build.json && tsc -p tsconfig.build.cjs.json && node ../../scripts/write-cjs-marker.mjs dist/cjs",
```

Leave `"type": "module"`, `"files"`, and every other field unchanged.

**Verify**:
```
pnpm --filter @askdb/core build
test -f packages/core/dist/index.js && test -f packages/core/dist/cjs/index.js && test -f packages/core/dist/cjs/package.json && echo OK
node -e "const m=require('./packages/core/dist/cjs/index.js'); if(typeof m.ask!=='function') throw new Error('ask missing'); if(typeof m.loadSchema!=='function') throw new Error('loadSchema missing'); console.log('CJS require OK')"
```
→ `OK` then `CJS require OK`.

### Step 3: Confirm the ESM path is unchanged

**Verify**:
```
node --input-type=module -e "import('./packages/core/dist/index.js').then(m=>{ if(typeof m.ask!=='function') throw new Error('ask missing'); console.log('ESM import OK'); })"
pnpm --filter @askdb/core test
```
→ `ESM import OK`, then all tests pass.

### Step 4: Roll the same change out to `@askdb/client`, `@askdb/ai`, `@askdb/postgres`

Repeat Step 2 verbatim for each of `packages/client`, `packages/ai`, `packages/postgres`: create `tsconfig.build.cjs.json` with the same contents, update `main`, `exports`, and `build` identically.

**Verify** for each package `<p>` in `client ai postgres`:
```
pnpm --filter @askdb/<p> build
node -e "require('./packages/<p>/dist/cjs/index.js'); console.log('<p> CJS OK')"
```
→ `<p> CJS OK` for all three.

### Step 5: Fix `@askdb/config`'s incorrect `require` condition

`packages/config` already claims `require` support but points it at the ESM file. Give it a real CJS build the same way, and correct the export map:

```json
  "main": "./dist/cjs/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/cjs/index.js",
      "default": "./dist/index.js"
    }
  },
```

Do NOT proceed past this step until Step 6 is done — the CJS build of config is not correct yet.

**Verify**: `pnpm --filter @askdb/config build` → exit 0.

### Step 6: Preserve the dynamic ESM `import()` in `@askdb/config`'s CJS output

`packages/config/src/load-merge.ts:10` currently reads:

```ts
    const mod = await import(href);
```

Under `module: CommonJS`, `tsc` rewrites this to `require()`, which cannot load a user's ESM `askdb.config.mjs`. Replace it with an indirection that survives the CJS emit, mirroring the technique the ecosystem uses for this exact case:

```ts
/**
 * Real dynamic `import()` that survives a CommonJS emit.
 *
 * Under `module: commonjs` TypeScript rewrites a bare `import()` into
 * `require()`, which cannot load a user's ESM `askdb.config.mjs`. Building the
 * call through `Function` keeps it a genuine dynamic import in both builds.
 */
const nativeImport = new Function("specifier", "return import(specifier);") as (
  specifier: string,
) => Promise<{ default?: unknown }>;
```

then at line 10:

```ts
    const mod = await nativeImport(href);
```

Place the `nativeImport` const at module scope, directly below the existing imports. Do not change any other line in the file, and do not touch the two `jiti` call sites (lines 14 and 60) — those are the synchronous path and are already correct.

**Verify**:
```
pnpm --filter @askdb/config build
grep -n "require(" packages/config/dist/cjs/load-merge.js | grep -c "href" 
```
→ the grep count must be `0` (the `href` load must not have become a `require`). Then:
```
node -e "const m=require('./packages/config/dist/cjs/index.js'); if(typeof m.defineConfig!=='function') throw new Error('defineConfig missing'); console.log('config CJS OK')"
pnpm --filter @askdb/config test
```
→ `config CJS OK` and all tests pass.

### Step 7: Add a CommonJS consumer to the installable smoke test

The existing smoke consumer is ESM-only — `examples/installable-smoke/consumer/package.json` declares `"type": "module"`. A CJS variant is what actually guards this plan against regression.

Create `examples/installable-smoke/consumer-cjs/package.json`:

```json
{
  "name": "askdb-installable-smoke-cjs",
  "private": true,
  "version": "0.0.0",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "smoke": "node src/smoke.cjs"
  },
  "dependencies": {
    "@askdb/config": "__ASKDB_CONFIG_TARBALL__",
    "@askdb/core": "__ASKDB_CORE_TARBALL__"
  },
  "devDependencies": {
    "@types/node": "^22.13.14",
    "typescript": "^6.0.3"
  }
}
```

Note the absence of `"type": "module"` — that is the point of this fixture.

Create `examples/installable-smoke/consumer-cjs/src/smoke.cjs`:

```js
// Proves @askdb/core and @askdb/config are consumable from CommonJS without
// the `new Function('return import(...)')` workaround real consumers had to write.
const core = require("@askdb/core");
const config = require("@askdb/config");

for (const name of ["ask", "loadSchema", "AskDbError", "POSTGRES_DIALECT"]) {
  if (core[name] === undefined) {
    throw new Error(`smoke(cjs): @askdb/core is missing export "${name}"`);
  }
}
if (typeof config.defineConfig !== "function") {
  throw new Error("smoke(cjs): @askdb/config is missing defineConfig");
}

// The instanceof path the ESM-only layout used to break.
const err = new core.SqlValidationError("nope", "SQL_EMPTY");
if (!(err instanceof core.AskDbError)) {
  throw new Error("smoke(cjs): SqlValidationError is not an AskDbError");
}

console.log("smoke(cjs): OK");
```

Wire it into `examples/installable-smoke/run.sh`. Read the script first and follow its existing structure: it packs tarballs, substitutes the `__ASKDB_*_TARBALL__` placeholders (see the `j.dependencies[...]` block around line 246), installs, then runs `typecheck` and `smoke`. Add an equivalent install-and-run block for `consumer-cjs` after the existing consumer's block, substituting only `__ASKDB_CORE_TARBALL__` and `__ASKDB_CONFIG_TARBALL__`.

**Verify**: `pnpm smoke:install` → exit 0, and its output contains `smoke(cjs): OK`.

### Step 8: Full gate and changeset

Create `.changeset/dual-publish-cjs-esm.md` with a `patch` bump for `@askdb/core`, `@askdb/config`, `@askdb/client`, `@askdb/ai`, and `@askdb/postgres`. Body: state that these packages now publish a CommonJS build under the `require` condition alongside the existing ESM build, that no runtime behavior or exported symbol changed, and that `@askdb/config`'s previously broken `require` condition (which pointed at an ESM file and threw `ERR_REQUIRE_ESM` on Node 22.0–22.11) is now correct.

**Verify**: `pnpm build && pnpm lint && pnpm test && pnpm smoke:install` → all exit 0.

## Test plan

- **New fixture**: `examples/installable-smoke/consumer-cjs/` — asserts `require()` works for `@askdb/core` and `@askdb/config`, that the named exports are present, and that `instanceof` across the error hierarchy holds in the CJS build. Model it on the existing `examples/installable-smoke/consumer/src/smoke.ts`.
- **No new unit tests** — this plan changes packaging, not logic. The existing vitest suites must continue to pass unchanged; if any test needs editing to accommodate this change, that is a STOP condition.
- Verification: `pnpm test` → all pass, unchanged count. `pnpm smoke:install` → exit 0 including the new CJS block.

## Done criteria

ALL must hold:

- [ ] `pnpm build` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `pnpm test` exits 0 with no test files modified (`git status` shows no changes under `**/*.test.ts`)
- [ ] `pnpm smoke:install` exits 0 and its output contains `smoke(cjs): OK`
- [ ] For each of core, config, client, ai, postgres: `node -e "require('./packages/<p>/dist/cjs/index.js')"` exits 0
- [ ] For each of core, config, client, ai, postgres: `test -f packages/<p>/dist/cjs/package.json` succeeds
- [ ] `grep -n "href" packages/config/dist/cjs/load-merge.js | grep -c "require(" ` returns 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `.changeset/dual-publish-cjs-esm.md` exists
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any package's CJS build emits `import.meta` — grep the output: `grep -rn "import\.meta" packages/*/dist/cjs/` must return nothing. If it does, that file cannot be dual-published as written and needs a design decision, not a workaround.
- `tsc -p tsconfig.build.cjs.json` fails with module-resolution errors that cannot be fixed by the `moduleResolution: Node10` setting in Step 2. Do not start rewriting import specifiers in `src/` to make the CJS build pass — source changes beyond Step 6 are out of scope.
- Any existing test requires modification to keep passing.
- The `dist/cjs` output is more than roughly 2× the ESM output size, which would indicate the CJS build is pulling in something unexpected.
- You conclude a bundler (tsup/rollup) is needed instead of the two-`tsc`-passes approach. That may well be the right answer, but it is a larger change than this plan authorizes — report the specific blocker.

## Maintenance notes

- **Every new package must adopt this from the start.** The pattern is: a `tsconfig.build.cjs.json`, the three-line `build` script, and the four-key `exports` block. When plan 041 restructures `@askdb/ai`, it must preserve the dual-build wiring added here.
- **The remaining packages still need this treatment**: `rag`, `introspect`, `enrich`, `mysql`, `sqlite`, `sqlserver`, `prisma`, `connectors`. They were deliberately deferred to keep this diff reviewable. `rag` needs extra care — `packages/rag/src/cli.ts:398` uses `import.meta.url` and must be excluded from its CJS build (it backs the `askdb-rag` bin, not the `.` export).
- **Dual-package hazard**: a consumer that loads both the ESM and CJS copies gets two distinct class identities, so `instanceof` across them fails. Plan 036 (brand-checked error predicates) is the durable fix and should follow this plan.
- **Reviewer focus**: confirm `types` still points at the single ESM `.d.ts` (no separate CJS declarations — they would drift), and that the `default` condition stays last in each `exports` block.
