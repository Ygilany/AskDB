# Contributing

AskDB is a pnpm/Turborepo TypeScript monorepo. Keep changes scoped to the package or app you are touching, and add tests for behavior that affects public APIs, package output, SQL safety, or user-facing workflows.

## Local Setup

```bash
pnpm install
pnpm build
pnpm test
```

Use Node 20 or newer and pnpm 11. Optional Postgres fixtures live under `fixtures/` for integration checks.

## Before Opening a PR

Run the release-style checks when a change affects published packages, CLIs, docs, workflows, or package metadata:

```bash
pnpm smoke:install
pnpm preflight
```

Add a changeset for publishable package changes:

```bash
pnpm changeset
```

AskDB is currently pre-1.0. Breaking public API changes should normally use a minor changeset unless the project intentionally moves a package to 1.0.

## Safety Boundary

AskDB public surfaces return generated SQL for review. They do not execute generated SQL. Any downstream execution must happen under the integrator's own database roles, read-only controls, tenant policy, approval process, and audit logging.

Never commit real `.env` files, API keys, database credentials, customer schemas, or production query outputs.
