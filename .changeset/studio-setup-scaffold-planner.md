---
"@askdb/studio": minor
---

Studio's guided setup writes its files from the scaffold planner in `@askdb/config/scaffold`, which `askdb init` shares (#711), so for the same answers the two write the same files. The config loads as before. What changes:

- **`.env.example` has `init`'s layout:** a `# purpose` comment above each empty `NAME=`, database variables first. Studio wrote `NAME= # purpose`, which Docker's `--env-file` reads as the value, and wrote each connection URL's format as its value.
- **The config's `rag.storeConfig` spans several lines**, as `init`'s does.
- **The variables setup lists come in `init`'s order and say what each is for**, such as `postgres connection URL, for introspection and Studio execute`.
- **An env var name may start with `_`**, as in `init`.
- **A Prisma project also gets `ai` and `zod`** when it doesn't have them (#760), which Yarn Plug'n'Play needs to load `@askdb/prisma`.
- **Errors for a bad answer** name the request field and say what's wrong, without repeating the value.
