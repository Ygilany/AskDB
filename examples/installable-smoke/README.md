# installable-smoke

End-to-end install smoke test for the published AskDB packages. Confirms a downstream consumer can `npm install` local package tarballs, get types resolving correctly, run the `ask()` pipeline against a **fake executor**, and load `@askdb/introspect` without a workspace.

This is the executable form of Phase 4 Group 4 (`docs/specs/phase-4-publish-npm/plan.md`).

## What it proves

1. **`@askdb/core` is installable** — `npm install <tarball>` succeeds without the workspace.
2. **No `pg` is required** — the consumer never installs the optional `pg` peer; importing `@askdb/core` and using a custom `executor` works.
3. **`@askdb/introspect` is installable** — public exports and the `@askdb/introspect/postgres` subpath resolve from the packed tarball.
4. **Executor seam wires through** — `ask()` calls the fake executor and returns its `TabularResult`.
5. **The introspection bin is packaged** — `askdb-introspect --version` and `askdb-introspect templates --engine postgres` run from `node_modules/.bin`.

The test fails clearly if any of these regress: `private: true` slips back, `dist/` loses files, types break, or the executor seam stops being honored.

## Run

From the repo root:

```bash
pnpm smoke:install
```

Or directly:

```bash
bash examples/installable-smoke/run.sh
```

The script works in a fresh `mktemp -d` directory, so the repo stays clean (no consumer `node_modules`, no tarballs committed).

## Layout

- `consumer/` — the consumer fixture (`package.json`, `tsconfig.json`, `src/smoke.ts`).
- `run.sh` — orchestrator: builds the workspace, packs packages, installs `@askdb/core` and `@askdb/introspect` into a copy of the consumer fixture, typechecks, runs the smoke script, and checks the introspection bin.
