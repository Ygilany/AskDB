---
"askdb": patch
---

`askdb init --connection-env <name> --studio-execute` now points Studio execute at the same env var as introspection, as the interactive wizard already did (#777). Before, the non-interactive path wrote `studio.execute.databaseUrl: env("DATABASE_URL")` whatever `--connection-env` named. With `--database prisma`, execute still targets Postgres and reads `DATABASE_URL`.
