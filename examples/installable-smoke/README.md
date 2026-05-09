# installable-smoke

End-to-end install smoke test for `@askdb/core`. Confirms a downstream consumer can `npm install` the published tarball, get types resolving correctly, and run the `ask()` pipeline against a **fake executor** with **no `pg` installed**.

This is the executable form of Phase 4 Group 4 (`docs/specs/phase-4-publish-npm/plan.md`).

## What it proves

1. **`@askdb/core` is installable** — `npm install <tarball>` succeeds without the workspace.
2. **No `pg` is required** — the consumer never installs the optional `pg` peer; importing `@askdb/core` and using a custom `executor` works.
3. **Types resolve** — `tsc --noEmit` is clean against the published `dist/index.d.ts`.
4. **Executor seam wires through** — `ask()` calls the fake executor and returns its `TabularResult`.

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

The script works in a fresh `mktemp -d` directory, so the repo stays clean (no `node_modules`, no tarballs committed).

## Layout

- `consumer/` — the consumer fixture (`package.json`, `tsconfig.json`, `src/smoke.ts`).
- `run.sh` — orchestrator: builds the workspace, packs the three packages, installs `@askdb/core` into a copy of the consumer fixture, typechecks, and runs the smoke script.
