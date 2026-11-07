---
"@askdb/config": minor
---

`bootstrapAskDbEnv()` and `loadAskDbConfigProjection*()` load a JavaScript config (`askdb.config.js`, `.cjs`, `.mjs`) with Node's own loader, and create jiti only for a TypeScript config (`.ts`, `.mts`, `.cts`) (#833). A JavaScript config now loads from inside an app's bundle, webpack included, where jiti can't start. Node's module rules now apply to it: a `.js` config that relied on jiti may fail with Node's own error, such as `SyntaxError: Unexpected token 'export'` for ES module syntax beside a `package.json` with `"type": "commonjs"`, or a config that imports a TypeScript file. Rename it to `.mjs` or `.ts`. A TypeScript config loads as before.
