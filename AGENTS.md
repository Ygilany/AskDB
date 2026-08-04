# AGENTS.md

Instructions for coding agents working in this repository (contributing to AskDB itself).
If you're an agent implementing AskDB *into a different project*, use the docs site's own
`AGENTS.md` at `/AGENTS.md` on askdb.tools instead — this file is about developing AskDB.

## Stack

pnpm workspace + Turborepo, TypeScript. Node 20+.

- `packages/core` — the NL-to-SQL pipeline (`ask()`), schema artifact loader.
- `packages/ai`, `packages/ai-*` — AI provider registry and adapters (openai/anthropic/google/azure).
- `packages/client` — config-driven facade (`createAskDb`) over `@askdb/core` + `@askdb/ai`.
- `packages/introspect`, `packages/postgres`, `packages/mysql`, `packages/sqlite`, `packages/sqlserver` — introspection + dialects.
- `packages/rag` — schema chunking/indexing/retrieval.
- `packages/enrich` — schema-authoring helpers used by Studio.
- `apps/cli` — the `askdb` binary.
- `apps/http-api` — HTTP wrapper over core.
- `apps/studio` — browser UI for schema enrichment.
- `apps/docs-site` — Starlight docs site (askdb.tools).

## Commands

```bash
pnpm install
pnpm build           # turbo run build
pnpm test            # turbo run test — integration tests run when DATABASE_URL is set
pnpm lint            # turbo run lint — TypeScript noEmit
pnpm docs:dev         # docs site at 127.0.0.1:4310
pnpm docs:build
```

Before opening or updating a PR, run the release-style checks:

```bash
pnpm smoke:install
pnpm preflight
```

## Where product/architecture decisions live

`docs/` is the constitution — check it before assuming behavior, not just the code:

- `docs/mission.md` — north star, principles, non-goals
- `docs/architecture.md` — package boundaries, install profiles
- `docs/contracts/` — formal contracts (modes, sensitive fields, schema format)
- `docs/adrs/` — architecture decision records

`apps/docs-site/src/content/docs/` is the public-facing docs (askdb.tools) — treat it as a
product surface, not just documentation. If you change a package's public API or add a new
integration pattern, the docs site needs a corresponding update or agents integrating AskDB
elsewhere will get stale guidance.

## Conventions

- AskDB returns SQL; it never executes it. Any code path that runs generated SQL against a
  real database belongs in a host app or a fixture/test harness, not in `packages/core`.
- `@askdb/ai-*` adapters and raw Vercel AI SDK `LanguageModel` objects are both first-party,
  equally supported ways to give `ask()` a model — don't privilege one over the other in new
  docs or examples without a reason tied to who owns provider config.
- Provider adapters declare `ai` and `@askdb/ai` as peer dependencies — don't hard-pin AI SDK
  versions inside adapters; let the host app's `package.json` pin them.
