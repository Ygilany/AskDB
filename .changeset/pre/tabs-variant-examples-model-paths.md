---
---

docs: add synced tabs to variant-heavy pages and bridge the two model-wiring paths

- bring-your-own-model: restructure around "In your config" vs "In your code" framing; add Tabs (syncKey="ai-provider") for OpenAI/Anthropic/Google/Azure in both the config and direct-SDK sections; add "One config driving both" section with createAiRegistry + createLanguageModelFromEnv registry snippet; Google is now a first-class provider tab
- switch-engines: convert Steps 1, 2, and 4 to Tabs (syncKey="engine") with PostgreSQL/MySQL/SQLite/SQL Server tabs; SQLite introspection uses the config-file form
- install: add Tabs (syncKey="pkg") npm/pnpm/yarn variants to all seven install blocks
- embed-in-node: convert the single install block to Tabs (syncKey="pkg")
- establishes site-wide syncKey contracts: "ai-provider", "engine", "pkg"
