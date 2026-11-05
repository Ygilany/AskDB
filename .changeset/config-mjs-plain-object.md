---
"@askdb/config": patch
"askdb": patch
"@askdb/docs-site": patch
---

`askdb.config.mjs` and a plain `export default { … }` config now load, as the docs say (#264, #265). `bootstrapAskDbEnv()`, and so the `askdb` CLI, Studio and the HTTP API, loads every documented extension synchronously, `.mjs` included; the file can't use top-level `await`. A plain object goes through the same normalizing, checks and deprecation warnings as `defineConfig({ … })`, which stays the typed helper and still returns the projection.

A config without its `ai` or `introspection` block now fails to load with an error that names the file and the missing block (`AskDB config at <path>: the config has no ai block; …`), instead of a bare `TypeError` (#626). Every `askdb.config: …` error raised while a file loads now names that file the same way; calling `defineConfig` directly keeps the `askdb.config:` prefix. A file with no default export, a default export that isn't a plain object (`null`, a string, a Promise), and top-level `await` each fail with an error that names the file and says what to change, instead of a misleading or bare one.
