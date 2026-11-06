---
"askdb": patch
"@askdb/docs-site": patch
---

`askdb init` writes its files from the scaffold planner in `@askdb/config/scaffold`, which Studio's guided setup shares (#711). `askdb.config.ts` doesn't change. What you may notice:

- **`init` checks the env var names and paths you pass.** A name for `--connection-env`, `--ai-key-env`, `--ai-model-env` or `--pgvector-env` must use uppercase letters, digits and underscores, and not start with a digit, and a path for `--sqlite-file`, `--prisma-schema` or `--schema-out` must not contain control characters. Otherwise `init` exits 1 before it writes anything, with an error that names the flag: `askdb init --connection-env my-url` used to write `env("my-url")`.
- **`--database prisma` also installs `ai` and `zod`** at the ranges `@askdb/core` uses (#760). Under Yarn Plug'n'Play, `askdb introspect --engine prisma` failed without them (`@askdb/core tried to access ai`).
- **`.env.example` leaves every value empty.** A connection URL's format moves from its value (`DATABASE_URL=postgresql://<USERNAME>:…`) into the comment above it, and every variable gets a comment that says what it's for. A variable that introspection and Studio execute share says so.
