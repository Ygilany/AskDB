# Plan 034: Make the published packages requireable from CommonJS

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 595182d..HEAD -- packages/*/package.json examples/installable-smoke`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `595182d`, 2026-08-05
- **Reconciled**: 2026-08-05 during execution. Step 4 now uses each package's Node self-reference because the repository root only declares `@askdb/config` as a workspace dependency; a root-level `require()` of the other packages tests the monorepo's dependency graph rather than their published export maps.
- **Execution**: DONE — implemented in `612af7b` and independently verified; PR [#174](https://github.com/Ygilany/AskDB/pull/174) is open against `main`.
- **Breaking**: No for existing ESM consumers — the `import` condition and the resolved file are unchanged. The `engines.node` floor rises to one Node 22.12 baseline (see Step 3), which is a declaration change rather than a behavior change.
- **Supersedes**: an earlier version of this plan that proposed dual-publishing a CommonJS build via two `tsc` passes. That was over-scoped — see "Why a CommonJS build is *not* the fix" below.

## Why this matters

`@askdb/core` cannot be loaded from a CommonJS application at all. Not "loads awkwardly" — Node refuses to resolve it.

Our first external integrator, a CommonJS TypeScript backend, worked around this with five files' worth of scaffolding: a `new Function('specifier', 'return import(specifier)')` escape hatch, a lazy-loading runtime wrapper class, the loaded module handle threaded through their error-classification function so `instanceof` had something to compare against, a structurally re-declared copy of our result types to avoid importing them, and fabricated stand-in classes in their tests.

The cause is one missing line in our export maps. Node matches export conditions in order; a `require()` finds no matching condition and fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` before the CommonJS-versus-ESM question is ever reached. Adding a `default` fallback makes the package resolvable, and Node's `require(esm)` support handles the rest.

## Current state

### What every package ships today

16 of 17 published packages declare exactly two conditions. `packages/core/package.json`:

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

Survey the whole set yourself before starting:

```bash
node -e "
const fs=require('fs');
for (const p of fs.readdirSync('packages')) {
  const f='packages/'+p+'/package.json';
  if(!fs.existsSync(f)) continue;
  const j=JSON.parse(fs.readFileSync(f,'utf8'));
  if(j.private) continue;
  console.log((j.name+'                       ').slice(0,26), 'engines:', (j.engines?.node??'-'), '| subpaths:', Object.keys(j.exports??{}).length, '| root cond:', Object.keys(j.exports?.['.']??{}).join(','));
}"
```

At `595182d` this prints `types,import` for every package except `@askdb/config`, which has `types,import,require,default`. Two packages need special handling: `@askdb/rag` has **6 subpath exports**, each needing the same treatment, and `@askdb/config` is already correct in substance (see Step 2).

`engines.node` originally varied between `>=22` and `>=20`; the implemented policy standardizes every published package on Node `>=22.12`.

### The reproduction, and the proof that one line fixes it

Three packages with identical ESM source, differing only in the export map. Run this yourself — it is the whole basis of the plan:

```bash
cd /tmp && rm -rf exp034 && mkdir -p exp034/node_modules/fake-esm && cd exp034
printf '{"name":"exp","version":"1.0.0"}\n' > package.json
printf 'export const hello = () => "hi";\n' > node_modules/fake-esm/i.js

# A — what @askdb/core ships today
printf '{"name":"fake-esm","version":"1.0.0","type":"module","exports":{".":{"types":"./i.d.ts","import":"./i.js"}}}\n' > node_modules/fake-esm/package.json
node -e "try{require('fake-esm');console.log('A: OK')}catch(e){console.log('A: FAILED', e.code)}"

# B — what ai@7 ships, and what this plan adopts
printf '{"name":"fake-esm","version":"1.0.0","type":"module","exports":{".":{"types":"./i.d.ts","import":"./i.js","default":"./i.js"}}}\n' > node_modules/fake-esm/package.json
node -e "const m=require('fake-esm');console.log('B:', typeof m.hello==='function' ? 'OK' : 'unexpected')"
```

Expected: `A: FAILED ERR_PACKAGE_PATH_NOT_EXPORTED`, then `B: OK`. B loads an ESM file through `require()` with no CommonJS build anywhere.

Clean up with `rm -rf /tmp/exp034` when done.

### What `ai@7` does, for comparison

```json
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  }
```

`ai` dropped its separate CommonJS build but kept the `default` fallback, so it stays requireable. Our maps are strictly less requireable than a dependency we already ship. Confirm `require('ai')` works today:

```bash
cd packages/core && node -e "console.log('ai requireable:', Object.keys(require('ai')).length > 0)"
```

### The two constraints this approach carries

**Node floor.** `require()` of an ESM module is unflagged from Node 20.19.0 and 22.12.0 onward. AskDB standardizes on **Node 22.12.0** for every published package, rather than supporting different major lines package-by-package.

**No top-level await in a requireable module graph.** If an ESM module reached from an `exports` entry uses top-level `await`, `require()` of that entry fails — the evaluation cannot be made synchronous. A package may also ship a CLI executable that is not an export target; that executable is launched with `node`, not loaded through `require()`, so it is outside this constraint. In particular, `@askdb/rag`'s `src/bin.ts` is compiled for the `askdb-rag` executable and has top-level `await`, but no `exports` entry or exported module imports it.

```bash
for p in core client ai postgres config rag introspect enrich connectors mysql sqlite sqlserver prisma; do
  echo "$p exports:" $(node -e "
    const j=require('./packages/$p/package.json');
    console.log(Object.values(j.exports ?? {}).every((entry) => entry.default));
  ")
done
```

Every line must read `true`. Step 5 adds the actual permanent guard: it traces from export targets through their relative static imports, because that is the module graph whose top-level `await` would silently break requireability.

### Why a CommonJS build is *not* the fix

The obvious alternative is emitting a real CJS build (two `tsc` passes, or `tsup`). It was considered and rejected:

- It would not lower the Node floor. `packages/core/src/sql/generate.ts` imports `generateText` from `ai` at module top level, so loading `@askdb/core` loads `ai` — which is ESM-only-with-`default` and needs `require(esm)` regardless. A CJS build of core buys nothing on Node 20.18 or 22.10.
- A second `tsc` pass forces `module: CommonJS`, which forces `moduleResolution: Node10` (the only valid pairing — `Bundler` requires an ES module target, and `Node16`/`NodeNext` both require a matching `module` *and* would emit ESM anyway, since they derive each file's format from the nearest `package.json` `"type"` relative to the **source**). `Node10` ignores `exports` maps entirely, which is fragile against modern dependencies.
- `tsup` would avoid that friction but adds a build-system change across every package for a benefit the first bullet already eliminates.

If a future dependency introduces top-level await, or if supporting Node below 22.12 becomes a requirement, revisit — and use `tsup`, not two `tsc` passes.

### Conventions

- Manifest key order is: name, version, description, keywords, homepage, bugs, repository, directory, license, author, type, main, types, exports, files, engines, scripts, dependencies, peerDependencies, devDependencies. Match `packages/core/package.json` exactly.
- Changesets live in `.changeset/*.md`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Build | `pnpm build` | exit 0 |
| Typecheck | `pnpm lint` | exit 0 |
| Tests | `pnpm test` | all pass |
| Install smoke | `pnpm smoke:install` | exit 0 |
| Node version | `node -v` | must be ≥ 22.12 to verify locally |

## Scope

**In scope**:
- The `exports` map and `engines.node` of every published package under `packages/*/package.json`
- `examples/installable-smoke/consumer-cjs/**` (create) and `examples/installable-smoke/run.sh`
- One guard test asserting no top-level await in any exported module graph, and one asserting every published export map has a `default` condition — location per Step 5
- `docs/integration/installable-package.md` — a short CommonJS note
- `.changeset/requireable-from-commonjs.md` (create)

**Out of scope** (do NOT touch):
- Any file under `packages/*/src/`. This plan changes packaging metadata only. The single exception is creating the guard test in Step 5.
- Emitting a CommonJS build, adding `tsup`, or creating any `tsconfig.build.cjs.json`. See the rejection above; if you conclude a build is needed, that is a STOP condition.
- The `main` and `types` fields. They already point at the right files and serve legacy `moduleResolution: node10` consumers.
- Removing `@askdb/config`'s existing `require` condition beyond the normalization in Step 2.
- Making `packages/core`'s import of `ai` lazy. Plausible and out of scope.

## Git workflow

- **Branch from an up-to-date `main`.** The branch this plan was authored alongside has already been merged and deleted on GitHub; do not attempt to reuse or rebase onto it. Run `git fetch origin && git switch -c advisor/034-requireable-from-commonjs origin/main`.
- Commit style matches recent history, e.g. `fix(packaging): make published packages requireable from CommonJS`. Recent examples: `feat(core): add shared SQL parameter binder`, `fix(core): make SQL literal escaping dialect-aware`.
- **Open a PR against `main`** when the done criteria pass — this one is expected to ship rather than sit locally. Use `gh pr create --base main`. Title it after the plan; the body should lead with the `ERR_PACKAGE_PATH_NOT_EXPORTED` reproduction and the Node floor change, since those are what a reviewer needs to evaluate.

## Steps

### Step 1: Add a `default` condition to every published package

For each published package under `packages/`, add `"default"` as the **last** condition of each export entry, pointing at the same file as `"import"`.

Condition order is significant — Node takes the first match, so `default` must come last or it will shadow more specific conditions:

```json
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
```

`@askdb/rag` has six entries (`.`, `./stores/memory`, `./stores/file`, `./stores/pgvector`, `./embedders/openai`, `./embedders/ai-sdk`). **Every one needs it**, each pointing at its own file. A consumer requiring `@askdb/rag/stores/memory` hits the same failure as the root entry.

Do not add an explicit `require` condition. `default` covers `require` and every other consumer, and one fallback is easier to keep correct than two. This matches what `ai` ships.

**Verify**:
```bash
node -e "
const fs=require('fs');
let bad=[];
for (const p of fs.readdirSync('packages')) {
  const f='packages/'+p+'/package.json';
  if(!fs.existsSync(f)) continue;
  const j=JSON.parse(fs.readFileSync(f,'utf8'));
  if(j.private||!j.exports) continue;
  for (const [sub,cond] of Object.entries(j.exports)) {
    const keys=Object.keys(cond);
    if(!keys.includes('default')) bad.push(j.name+' '+sub+' (no default)');
    else if(keys[keys.length-1]!=='default') bad.push(j.name+' '+sub+' (default not last)');
  }
}
if(bad.length){console.log('FAIL:');bad.forEach(b=>console.log('  '+b));process.exit(1)}
console.log('all export maps OK');"
```
→ `all export maps OK`.

### Step 2: Normalize `@askdb/config`

`@askdb/config` already declares `types, import, require, default`. It works — `require` matches, resolves the ESM file, and `require(esm)` handles it — but it is the only package spelled differently, and the extra `require` condition pointing at an ESM file reads like a mistake to anyone auditing it.

Drop the redundant `require` entry so it matches the shape from Step 1. Keep `default`.

**Verify**: the Step 1 script still prints `all export maps OK`, and `node -e "console.log(Object.keys(require('./packages/config/package.json').exports['.']).join(','))"` prints `types,import,default`.

### Step 3: Standardize the Node floor at Node 22.12

`require()` of ESM is unflagged from Node 20.19.0 and 22.12.0. AskDB supports a single Node 22.12 baseline, so every package advertises the same supported version rather than splitting consumers across two major lines.

Set every published package's `engines.node` field to `">=22.12"`. Check the current values with the survey command from "Current state" and change only the `engines.node` field.

**Verify**:
```bash
node -e "
const fs=require('fs');
for (const p of fs.readdirSync('packages')) {
  const f='packages/'+p+'/package.json';
  if(!fs.existsSync(f)) continue;
  const j=JSON.parse(fs.readFileSync(f,'utf8'));
  if(j.private) continue;
  const e=j.engines?.node??'';
  if(e!=='>=22.12') { console.log('FAIL: '+j.name+' has '+e); process.exit(1); }
}
console.log('engines OK');"
```
→ `engines OK`. Then `pnpm install` → exit 0 with no engine warnings.

### Step 4: Prove it against the real built packages

The `/tmp` experiment proved the mechanism. This proves it for our actual output.

```bash
pnpm build
for entry in \
  'packages/core:@askdb/core' \
  'packages/config:@askdb/config' \
  'packages/client:@askdb/client' \
  'packages/ai:@askdb/ai' \
  'packages/postgres:@askdb/postgres'; do
  dir=${entry%%:*}
  name=${entry#*:}
  (
    cd "$dir"
    node -e "const m=require('$name'); if (!Object.keys(m).length) process.exit(1); console.log('$name', 'OK —', Object.keys(m).length, 'exports')"
  ) || exit 1
done
```

Every line must print `OK` with a non-zero export count. Node resolves a package's own `name` through its `exports` map when the command runs from that package directory. Do **not** run these imports from the repository root: its manifest deliberately links only `@askdb/config`, so `MODULE_NOT_FOUND` for the other packages there says nothing about their published export maps.

Also confirm the named exports a CommonJS consumer would actually reach:

```bash
cd packages/core && node -e "
const core=require('@askdb/core');
for (const s of ['ask','loadSchema','AskDbError','POSTGRES_DIALECT']) {
  if (core[s]===undefined) { console.log('MISSING', s); process.exitCode=1; }
}
const e=new core.SqlValidationError('nope','SQL_EMPTY');
if (!(e instanceof core.AskDbError)) { console.log('instanceof broken'); process.exitCode=1; }
console.log('named exports + instanceof OK');"
```

**Verify**: both scripts exit 0.

### Step 5: Add the two guards that stop this regressing

Both failures this plan fixes are invisible until a consumer hits them, so they need automated guards. Put them in a test file under `packages/core/src/` (or wherever the repo keeps cross-package checks — look for an existing one first with `ls packages/*/src/*.test.ts | head`) and say in your report where you put them.

**Guard A — every published export map has `default` last.** Reuse the Step 1 script's logic as a vitest assertion, reading the manifests from disk. This catches a new package added without the condition.

**Guard B — no top-level await in exported module graphs.** For every `default` export target, map its `./dist/*.js` path to the corresponding `src/*.ts` file. Starting at those files, recursively follow relative static `import` and `export ... from` specifiers (replace the emitted `.js` suffix with `.ts`) and assert none of the reached files contains a module-scope `await`. A line-anchored check (`/^await /m`, plus `/^const .* = await /m`) covers the realistic cases; a full parse is overkill. Do **not** scan all `src/` files indiscriminately: a package CLI such as `packages/rag/src/bin.ts` can legitimately use top-level await because it is started by Node and is not requireable through the export map. Comment the test with *why* it exists — that top-level await in an exported graph silently breaks `require()` — because otherwise someone will delete it as pointless.

**Verify**: `pnpm test` → both new tests pass. Then deliberately break each one (add `await Promise.resolve();` at module scope in a scratch file; remove a `default` from a manifest), confirm the corresponding test fails, and revert. A guard that has never been seen to fail is not a guard.

### Step 6: Add a CommonJS consumer to the installable smoke test

The existing smoke consumer is ESM-only — `examples/installable-smoke/consumer/package.json` declares `"type": "module"`. The CJS variant is what tests this from a real install rather than a workspace link.

Create `examples/installable-smoke/consumer-cjs/package.json` with **no** `"type": "module"`:

```json
{
  "name": "askdb-installable-smoke-cjs",
  "private": true,
  "version": "0.0.0",
  "scripts": { "smoke": "node src/smoke.cjs" },
  "dependencies": {
    "@askdb/config": "__ASKDB_CONFIG_TARBALL__",
    "@askdb/core": "__ASKDB_CORE_TARBALL__"
  }
}
```

Create `examples/installable-smoke/consumer-cjs/src/smoke.cjs` asserting what Step 4 asserted — `require()` succeeds, the named exports are present, and `instanceof` holds across the error hierarchy — and printing `smoke(cjs): OK` on success.

Wire it into `examples/installable-smoke/run.sh` following the existing consumer's block: it packs tarballs, substitutes the `__ASKDB_*_TARBALL__` placeholders (see the `j.dependencies[...]` block around line 246), installs, then runs. Read the script before editing.

**Verify**: `pnpm smoke:install` → exit 0, output contains `smoke(cjs): OK`.

### Step 7: Document the constraint, and write the changeset

Add a short subsection to `docs/integration/installable-package.md` stating that AskDB packages are ESM and are requireable from CommonJS on Node ≥22.12 via Node's `require(esm)` support; that `const { ask } = require("@askdb/core")` works; and that below that version consumers must use dynamic `import()`. Match the file's existing heading depth and code-fence style.

Create `.changeset/requireable-from-commonjs.md` — **minor** for every package whose manifest changed (the `engines` floor is a declaration change worth a minor). The body must state: CommonJS applications can now `require()` these packages, where previously resolution failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`; the minimum Node version is now 22.12; and no runtime behavior or exported symbol changed.

**Verify**: `pnpm build && pnpm lint && pnpm test && pnpm smoke:install && pnpm docs:build` → all exit 0.

## Test plan

- **Guard A and Guard B** from Step 5, each verified to fail when deliberately broken.
- **The CJS smoke consumer** from Step 6 — the only test that exercises a real install rather than workspace links, which is what makes it worth the setup.
- **No existing test should change.** This plan edits manifests. If a test needs modification, that is a STOP condition.
- Verification: `pnpm test` → all pass with two new tests; `pnpm smoke:install` → exit 0.

## Done criteria

ALL must hold:

- [ ] The Step 1 verification script prints `all export maps OK`
- [ ] The Step 3 verification script prints `engines OK`
- [ ] After `pnpm build`, each package's Node self-reference successfully `require()`s `@askdb/core`, `@askdb/config`, `@askdb/client`, `@askdb/ai`, and `@askdb/postgres`
- [ ] `require('@askdb/core')` exposes `ask`, `loadSchema`, `AskDbError`, `POSTGRES_DIALECT`, and `instanceof` holds across the error hierarchy
- [ ] Guard A and Guard B exist, pass, and were each observed to fail when deliberately broken — stated in your report
- [ ] `pnpm smoke:install` exits 0 and output contains `smoke(cjs): OK`
- [ ] `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm docs:build` all exit 0
- [ ] `git diff --name-only -- 'packages/*/src'` shows only the new guard test file
- [ ] No `tsconfig.build.cjs.json` was created anywhere; `tsup` is not in any manifest
- [ ] `.changeset/requireable-from-commonjs.md` exists
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] A PR is open against `main`
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The Step 1 or Step 4 `require()` of a real built package still fails after adding `default`. Report the exact error code — if it is `ERR_REQUIRE_ESM` rather than `ERR_PACKAGE_PATH_NOT_EXPORTED`, the local Node is below the floor and you should re-run on 22.12+ before concluding anything.
- The exported-module-graph scan finds a top-level-await match. That export cannot be made requireable without removing it; report the export and source file, and leave that package's export map unchanged. A match in a non-exported CLI entrypoint is expected to be excluded by the guard.
- `pnpm install` reports engine incompatibilities after Step 3 — that would mean some workspace tool cannot run on the raised floor.
- Any existing test breaks.
- You conclude a real CommonJS build is needed after all. Report the specific reason; the rejection reasoning is in "Current state" and reversing it is a maintainer decision, not an executor one.
- Your local Node is below 22.12 (`node -v`). Most verification steps will produce misleading failures. Report and stop rather than working around it.

## Maintenance notes

- **Every new published package needs `default` in its export map and the raised `engines` floor.** Guard A makes the omission a test failure instead of a support ticket. Keep it.
- **Top-level await in an exported module graph is now a breaking packaging change**, not just a stylistic choice. Guard B is the tripwire; its comment explains why. A CLI-only entrypoint is not in that graph. If a genuine need for top-level await arises in an exported graph, that package must either drop CommonJS requireability or gain a real CJS build — a deliberate decision, not a side effect.
- **This does not make the packages CommonJS.** They remain ESM and are *loaded* through `require(esm)`. The practical differences a consumer may notice: the returned value is a module namespace object (frozen, no `__esModule` interop marker), and there is no default export to unwrap. Both are fine for our packages, which export only named symbols.
- **The Node floor is set by `require(esm)` availability and AskDB's one-line support policy, not by our code.** If the project ever needs to support Node below 22.12, the only route is a real CJS build — and even then `ai` would still gate the model path, so it would only help schema-only consumers.
- **Related follow-up**: plan 036 (brand-checked error predicates) was originally justified partly by dual-publishing creating duplicate module instances. That reasoning does not apply here — `require()` and `import()` of the same package return the *same* namespace object, verified. Plan 036 still stands on its independent justification (removing the module-handle threading, and surviving two copies of the package at different versions in one tree), but its dependency note has been corrected.
- **Reviewer focus**: that `default` is last in every condition object (order is load-bearing), that `engines` was raised in the correct major line rather than bumped wholesale, and that both guards were actually observed failing.
