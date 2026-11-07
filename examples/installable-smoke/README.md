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
8. **Package bins are packaged** — `askdb` (including `askdb rag`) and `askdb-studio` run from `node_modules/.bin`, and `@askdb/rag` installs no `askdb-rag` bin.
9. **`ai` is a host-owned peer** — the consumers declare `ai` themselves. A separate `consumer-ai6/` fixture installs `@askdb/core` + `@askdb/rag` next to the AI SDK 6 floor, pinned exactly (`ai@6.0.0`, `@ai-sdk/openai@3.0.0`; no `--legacy-peer-deps`), asserts core did not nest its own `ai` and that `@askdb/config` isn't installed (`@askdb/rag` doesn't depend on it), type-checks an AI SDK 6 provider model against `AskDbLanguageModel` with `skipLibCheck: false` (so a core or rag declaration that needs an AI SDK 7 type fails here instead of silently becoming `any`; `@types/json-schema` is there because `ai@6.0.0`'s `@ai-sdk/provider` declarations import it without depending on it), and runs `ask()` and the RAG AI SDK embedder through AI SDK 6 with mock models — including that the NL→SQL system prompt reaches the model.
10. **Optional peers stay optional in a bundle** — esbuild bundles `@askdb/client` and the engine packages with no other `@ai-sdk/*` package and no database driver installed; a missing provider SDK and each missing driver (`pg`, `mysql2`, `better-sqlite3`, `mssql`) fail at runtime with their install hint. This guards the `.catch()` chained on each optional `import()`.
11. **The apps load under Yarn Plug'n'Play** — Plug'n'Play gives a package its peer only through the package that depends on it, so a package that depends on `ai` or an `@ai-sdk/*` package must provide `zod`, and one that depends on `@askdb/core` must pass `ai` through (#748). `yarn-pnp.sh` first checks every packed manifest for both rules, which covers packages the commands never load, such as `@askdb/prisma`. It then installs only `askdb` and `@askdb/http-api` (every AskDB package from its tarball, through `resolutions`) into a Yarn 4 project with `nodeLinker: pnp` and `pnpFallbackMode: none`, as `yarn dlx askdb` does but without the fallback to the project's own dependencies. `askdb --version`, `--help`, `introspect templates`, `studio --help`, `rag --help` and `askdb-http --help` must load and exit 0.

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
- `consumer-cjs/` — CommonJS `require()` consumer of `@askdb/config`, `@askdb/core` and the `@askdb/introspect/kit` subpath.
- `consumer-bundle/` — an esbuild-bundled host of `@askdb/client` and the four engine packages (`@askdb/postgres`, `@askdb/mysql`, `@askdb/sqlite`, `@askdb/sqlserver`) with only `@ai-sdk/openai` installed and no database driver.
- `consumer-ai6/` — AI SDK 6 host pinned at AskDB's AI SDK 6 floor (`ai@6.0.0`, `@ai-sdk/openai@3.0.0`) consuming `@askdb/core` and `@askdb/rag`. A floor rise moves these pins (ADR 0015).
- `yarn-pnp.sh` — the Yarn 4 Plug'n'Play check, run last by `run.sh`; it takes the tarball directory and a work directory, and runs Yarn from a pinned `@yarnpkg/cli-dist` release, not Corepack.
- `run.sh` — orchestrator: builds the workspace, packs packages, installs `@askdb/core`, `@askdb/introspect`, `@askdb/postgres`, `@askdb/prisma`, `@askdb/enrich`, and `@askdb/rag` into a copy of the consumer fixture, typechecks, runs the smoke script, and checks package bins.
