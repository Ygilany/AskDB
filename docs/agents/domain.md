# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase. AskDB is a **single-context** repo: one product domain across many packages.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, if it exists: the domain glossary.
- **`docs/adrs/`** (note: `adrs`, plural): read ADRs that touch the area you're about to work in.
- **`docs/`** is the constitution. `docs/mission.md`, `docs/architecture.md`, `docs/contracts/` and `docs/specs/` describe settled behavior (see `AGENTS.md`). Check them before assuming behavior from the code alone.

If `CONTEXT.md` doesn't exist, **proceed silently**. Don't flag its absence, and don't suggest creating it upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates it lazily when terms or decisions actually get resolved.

## File structure

```
/
├── CONTEXT.md            ← created lazily by /domain-modeling
├── docs/
│   ├── adrs/             ← architecture decision records (0001-…, 0002-…)
│   ├── contracts/        ← formal contracts (schema v2, modes, sensitive fields, tenant policy)
│   └── specs/            ← feature specs for settled behavior
├── packages/…
└── apps/…
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md` and `docs/contracts/`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal. Either you're inventing language the project doesn't use (reconsider), or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR 0006 (AI provider integration strategy), but worth reopening because…_

If the conflict is between a doc and the code's behavior, file it as a `discrepancy` issue (see `docs/agents/issue-tracker.md`).
