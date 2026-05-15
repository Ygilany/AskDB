---
"askdb": minor
"@askdb/config": patch
"@askdb/introspect": patch
"@askdb/tui": patch
---

**Breaking for npm consumers:** the CLI is published as the unscoped package **`askdb`** (was `@askdb/cli`). Update `package.json` dependencies and install commands accordingly (`npm i askdb`, `npx askdb init`, etc.). The `askdb` binary name is unchanged.

Also updates a `@askdb/config` bootstrap doc comment that referenced the old package name, plus README cross-links in `@askdb/introspect` and `@askdb/tui`.
