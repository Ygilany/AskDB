---
"askdb": minor
"@askdb/docs-site": patch
---

`askdb init` writes its files from the scaffold planner in `@askdb/config/scaffold`, which Studio's guided setup shares (#711). `askdb.config.ts` doesn't change. `init` now rejects some flag values it accepted, so this is a minor:

- **An invalid env var name fails.** `--connection-env`, `--ai-key-env`, `--ai-model-env` and `--pgvector-env` take a name of uppercase letters, digits and underscores that doesn't start with a digit (`DATABASE_URL`, `_PRIVATE_URL`). Anything else, such as `my-url` or `database_url`, used to land in the config as `env("my-url")` and now fails.
- **A path with a control character fails.** `--sqlite-file`, `--prisma-schema` and `--schema-out` reject a newline, a tab, NUL, DEL, U+2028 or U+2029. (`--sqlite-file` still reads a value that isn't an env var name as a path, as before.)
- Either way, `init` exits 1 before it writes anything, with an error that names the flag, such as `--connection-env must be an environment variable name like DATABASE_URL: …`.

Other changes:

- **`.env.example` leaves every value empty.** Each variable is an empty `NAME=` line under a `# purpose` comment, database variables first. A connection URL's format moves from its value (`DATABASE_URL=postgresql://<USERNAME>:…`) into that comment, and a variable that introspection and Studio execute share says so.
- **`--database prisma` also installs `ai` and `zod`** (#760): `ai` at the newest major `@askdb/core` accepts, and `zod` at core's range. Under Yarn Plug'n'Play, `askdb introspect --engine prisma` failed without them (`@askdb/core tried to access ai`).
- **`init` installs a package other than AskDB's own only when `package.json` doesn't list it yet.** A project on `ai@^6` keeps it, and a driver you already list isn't re-added at its latest version.
