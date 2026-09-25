# installable-smoke

End-to-end install smoke test for the published AskDB packages. Confirms a downstream consumer can `npm install` local package tarballs, get types resolving correctly, run the SQL-generation-only `ask()` pipeline, load `@askdb/introspect`, use `@askdb/enrich`, and wire `@askdb/rag` without a workspace.

This is the executable form of Phase 4 Group 4 (`docs/specs/phase-4-publish-npm/plan.md`).

## What it proves

1. **`@askdb/core` is installable** — `npm install <tarball>` succeeds without the workspace.
2. **No `pg` is required** — the consumer never installs the optional `pg` peer; importing `@askdb/core` and generating SQL works.
3. **`@askdb/introspect` is installable** — public exports resolve from the packed tarball.
4. **`@askdb/prisma` is installable** — the schema-file connector resolves without a database connection.
5. **`@askdb/enrich` is installable** — public workspace helper exports resolve from the packed tarball.
6. **`@askdb/rag` is installable** — public exports and the `@askdb/rag/stores/memory` subpath resolve, an in-memory index builds, and `ask({ retriever })` completes.
7. **Catalog runner type resolves** — `@askdb/introspect` exposes `CatalogQueryRunner` for connector-owned catalog reads.
8. **Package bins are packaged** — `askdb`, `askdb-studio`, and `askdb-rag` run from `node_modules/.bin`.
9. **`ai` is a host-owned peer** — the consumers declare `ai` themselves. A separate `consumer-ai6/` fixture installs `@askdb/core` + `@askdb/rag` next to `ai@6` and `@ai-sdk/openai@3` (no `--legacy-peer-deps`), asserts core did not nest its own `ai`, type-checks an AI SDK 6 provider model against `AskDbLanguageModel`, and runs `ask()` and the RAG AI SDK embedder through AI SDK 6 with mock models — including that the NL→SQL system prompt reaches the model.

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
- `consumer-cjs/` — CommonJS `require()` consumer of `@askdb/config` and `@askdb/core`.
- `consumer-ai6/` — AI SDK 6 host (`ai@6`, `@ai-sdk/openai@3`) consuming `@askdb/core` and `@askdb/rag`.
- `run.sh` — orchestrator: builds the workspace, packs packages, installs `@askdb/core`, `@askdb/introspect`, `@askdb/postgres`, `@askdb/prisma`, `@askdb/enrich`, and `@askdb/rag` into a copy of the consumer fixture, typechecks, runs the smoke script, and checks package bins.
