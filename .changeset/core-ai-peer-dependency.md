---
"@askdb/core": minor
"@askdb/rag": patch
"@askdb/studio": patch
---

**@askdb/core**: `ai` is now a **peer dependency** (`^6.0.0 || ^7.0.0`) instead of a bundled dependency, so the host application owns its AI SDK version.

`ask()` takes a `LanguageModel` your app constructs, so core has to use the same `ai` instance your app does. Bundling `ai` pinned core's own copy: when `1.0.0-beta.41` moved that pin to `ai@^7`, hosts on AI SDK 6 (e.g. `ai@^6` + `@ai-sdk/openai@^3`) had to either migrate their whole AI stack or end up with two copies of `ai` whose `LanguageModel` types disagree. Both AI SDK 6 and AI SDK 7 hosts are now supported.

**Migration (install-time breaking):** if you relied on `ai` arriving transitively through `@askdb/core` (or through `@askdb/postgres`, `@askdb/introspect`, `@askdb/rag`, …), add it to your own `package.json`:

```bash
pnpm add ai            # or: npm install ai
```

npm 7+ and pnpm (with the default `auto-install-peers`) install a missing required peer automatically, but declaring it pins the version you actually use. No source changes are needed.

Core now passes the NL→SQL and enrichment system prompts to `generateText` as `system`, which AI SDK 6 reads and AI SDK 7 still honors as a deprecated alias of `instructions`. This also fixes AI SDK 6 hosts silently losing the system prompt: AI SDK 6 ignores `instructions`.

**@askdb/rag**: the optional `ai` and `@ai-sdk/openai` peers now accept AI SDK 6 as well (`ai` `^6.0.0 || ^7.0.0`, `@ai-sdk/openai` `^3.0.0 || ^4.0.29`), so AI SDK 6 hosts can install `@askdb/rag` without a peer conflict. `createAiSdkEmbedder` works with either major.

**@askdb/studio**: the Playground's "Get the code" snippet for direct `@askdb/core` wiring now includes `ai` in its install line.

The config-driven path (`@askdb/ai`, `@askdb/ai-*` adapters, `@askdb/client`) still requires AI SDK 7.
