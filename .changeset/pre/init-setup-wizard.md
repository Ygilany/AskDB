---
"askdb": minor
---

feat(cli): `askdb init` is now a setup wizard that writes a tailored config and installs selected packages

- In a TTY, `askdb init` opens a short interactive wizard (powered by `@inquirer/prompts`, lazy-loaded) that asks which database, AI provider, RAG store, and Studio execute mode you want. It then generates only the relevant config branches and installs only the packages for your chosen path.
- In CI and scripts, `askdb init --yes` runs silently with Postgres + OpenAI defaults. All wizard choices are also available as flags (`--database`, `--ai-provider`, `--rag-store`, `--studio-execute`, etc.).
- The generated `askdb.config.ts` includes only the selected `introspection.providerConfig` branch, the selected AI `providerConfig` branch, and the selected RAG `storeConfig` branch — no more deleting unused sections.
- The install plan is exact: SQL Server setups install `mssql`; SQLite setups install `better-sqlite3`; Prisma-only setups install no live DB driver unless Studio execute is enabled.
- `@inquirer/prompts` is added as a runtime dependency but is only imported when entering interactive mode.
