# Platform

This document records the **initial** technical baseline for AskDB (runtime, stack, and repo shape). Adjustments are expected as requirements sharpen; the constitution should stay aligned with `mission.md` and `roadmap.md`.

## Package management

- **pnpm** for all installs, workspaces, and scripts.

## Language and repo layout

- **TypeScript** as the primary language for application code, shared libraries, and tooling.
- **Monorepo** layout: separate packages for reusable core logic, CLI, SDK/API clients, and the web/embed experience.
- **Example consumer application (later)** — For development and QA, the repo may include a **small example app** that consumes the embeddable UI/SDK so we can exercise integration without relying on every consumer’s production host (see `roadmap.md`).

## Runtime and frameworks

- **Node.js** for CLI, local execution, and server-side packages.
- **Next.js** for the web application and embed-friendly UI, deployed on a **Vercel-friendly** workflow (preview deployments, environment separation).

## Web UI (first-party AskDB app)

The **AskDB web application** (anything we own and ship as our product UI) uses **Tailwind CSS** and **shadcn/ui**—no parallel in-repo component systems for that app.

Initialize shadcn for our Next monorepo app with this preset:

```bash
pnpm dlx shadcn@latest init --preset bdvw9Yrj --template next --monorepo
```

After init, add components with `pnpm dlx shadcn@latest add …` as needed.

## Integrators and headless use

**Headless** flows (CLI, MCP, HTTP API, SDK) do not require any AskDB UI. Users **bring their own frontend**: any framework and design system they choose. We publish contracts (types, API shapes, SDK calls)—not a mandated UI stack for consumers.

## Schema vs. database connectivity

- **Import-first** — The first-party app must support workflows where AskDB **never holds credentials** to the customer’s database: users **import** schema descriptions (or paste exported metadata). Generation and review run against that **describable schema** artifact.
- **Optional live database** — When customers want **in-app execution**, validation against a live instance, or automated sync, they can attach **BYO** connection details on their infrastructure; that path is **not** required for schema enrichment, NL→SQL drafting, or export-only workflows.
- **Enrichment pipeline** — Parsing ingests a **pure** schema representation and produces (with AI + user input) a **describable schema**—labels, business meaning, sensitive flags—persisted for reuse.

## Data access

- **Postgres-first** — The first shipped path targets **PostgreSQL** end-to-end when a **live** connection or executor is used (connection, dialect assumptions in generation, execution, guardrails). Treat this as the **reference implementation** quality bar.
- **Other databases later** — Support for **additional engines** (beyond Postgres) lands in a **later roadmap phase**: per-engine drivers, dialect-aware generation/validation, and tests—rolled out **one database at a time** so we do not dilute safety or correctness. See **`roadmap.md`** (multi-database phase).

## AI and integrations

- **BYO API keys** — Model calls use customer-supplied keys; no mandatory centralized AI vendor for core usage.
- Room for a **RAG** layer over schema (and later selective metadata) without coupling the first milestone to a specific vector database—pick when Phase 1 pipeline is stable.

## Embeddability

- Target: **headless core + optional SDK** so teams can wire “ask your data” into their products; integrators own styling and components unless they choose to align with our patterns for consistency.
- If we later ship **optional** embed widgets or a UI kit, those would be our maintained surfaces (likely aligned with the first-party stack above); they remain **optional**—not a requirement for using AskDB.

## Other tooling

- Linter, formatter, and test runner follow repo conventions once added; versions are not fixed here.
