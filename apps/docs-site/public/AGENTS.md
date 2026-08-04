# AskDB — agent instructions

This file is for coding agents implementing AskDB into a project (e.g. wiring up NL-to-SQL
in someone's app). If you're building AskDB itself, see the repo's own `AGENTS.md` instead.

Machine-readable docs indexes:

- `/llms.txt` — page index with descriptions
- `/llms-full.txt` — full docs content in one file

## What AskDB is

AskDB is a library, not a service. `ask({ question, schema, model, dialect })` from
`@askdb/core` takes a schema artifact and a Vercel AI SDK `LanguageModel`, and returns
validated SQL. It does not execute SQL — your app runs it through its own connection.

## The one decision that matters: how you wire the model

`ask()`'s contract is `model: LanguageModel` — a plain Vercel AI SDK model object. There
are two first-party ways to produce one, and picking wrong means duplicating provider
config across two systems:

1. **`@askdb/ai-*` provider adapters + `@askdb/client`** — install `@askdb/client`,
   `@askdb/config`, and the adapter for your provider (`@askdb/ai-openai`,
   `@askdb/ai-anthropic`, `@askdb/ai-google`, `@askdb/ai-azure`). Provider selection lives
   in `askdb.config.ts` (`ai.provider`), and `createAskDb({ config, providers })` resolves
   schema, model, and dialect for you. Use this when AskDB should own provider config and
   the host app doesn't already have its own provider/config resolution.

2. **A raw AI SDK `LanguageModel` passed directly to `ask()`** — install `ai` and the
   matching `@ai-sdk/*` package (e.g. `@ai-sdk/openai`), construct the model yourself, pass
   it to `ask()`. Use this when the host app already resolves provider config elsewhere
   (env vars, a secrets manager, its own config system), or when you need to reuse the same
   model instance for LLM calls AskDB doesn't make (e.g. a `generateObject()` call for
   something unrelated next to the `ask()` call).

**Before choosing, check whether the host codebase already constructs AI SDK models
anywhere.** If it does, wire `ask()` with a model built the same way the rest of the app
builds models — don't introduce `@askdb/ai-*` as a second, parallel provider-config system
for one call site.

Full guide: `/guides/bring-your-own-model/`. Minimal embed example: `/guides/embed-in-node/`.

## Safety boundary

AskDB returns SQL; it never executes it. Do not wire generated SQL directly to a database
call without a review/approval step the host app controls. See `/concepts/safety-boundaries/`.

## If AskDB itself is an agent tool in your project

See `/guides/integrations/agents-mcp/` for wrapping `ask()` as a tool definition
(function-calling schema, tenant-scope handling, trust boundaries in an agent loop).
