# installable-smoke

End-to-end install smoke test for the published AskDB packages. Confirms a downstream consumer can `npm install` local package tarballs, get types resolving correctly, run the SQL-generation-only `ask()` pipeline, load `@askdb/introspect`, and wire `@askdb/rag` without a workspace.

This is the executable form of Phase 4 Group 4 (`docs/specs/phase-4-publish-npm/plan.md`).

## What it proves

1. **`@askdb/core` is installable** — `npm install <tarball>` succeeds without the workspace.
2. **No `pg` is required** — the consumer never installs the optional `pg` peer; importing `@askdb/core` and generating SQL works.
3. **`@askdb/introspect` is installable** — public exports and the `@askdb/introspect/postgres` subpath resolve from the packed tarball.
4. **`@askdb/rag` is installable** — public exports and the `@askdb/rag/stores/memory` subpath resolve, an in-memory index builds, and `ask({ retriever })` completes.
5. **Catalog runner type resolves** — `@askdb/introspect` exposes `CatalogQueryRunner` for connector-owned catalog reads.
6. **Package bins are packaged** — `askdb-introspect`, `askdb-tui`, and `askdb-rag` run from `node_modules/.bin`.

The test fails clearly if any of these regress: `private: true` slips back, `dist/` loses files, types break, or package surfaces stop resolving.

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
- `run.sh` — orchestrator: builds the workspace, packs packages, installs `@askdb/core`, `@askdb/introspect`, `@askdb/tui`, and `@askdb/rag` into a copy of the consumer fixture, typechecks, runs the smoke script, and checks package bins.
