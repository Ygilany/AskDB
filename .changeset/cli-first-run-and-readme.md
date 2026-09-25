---
"askdb": patch
"@askdb/core": patch
"@askdb/ai": patch
"@askdb/ai-anthropic": patch
"@askdb/ai-azure": patch
"@askdb/ai-google": patch
"@askdb/ai-openai": patch
"@askdb/mysql": patch
"@askdb/sqlite": patch
"@askdb/sqlserver": patch
---

**CLI: `--help` / `--version` work without a config; friendly missing-config error.**

- `askdb` no longer loads `askdb.config.*` before parsing arguments, so `askdb --help`, `-h`, `--version`, `-V`, `help`, no-args, `init`, `bundle`, `introspect --help`, and `introspect templates` all work in a directory without a config. Commands that read config (`ask`, `introspect`) load it lazily.
- `askdb --version` / `-V` is now supported and prints the package version.
- When a command needs config and none exists, the CLI prints `No askdb.config.* found in <cwd>. Run \`npx askdb init\` to create one.` and exits 1, with no stack trace. Other uncaught errors print their message only; set `DEBUG=1` to include the stack trace.

**Docs / packaging:** the `@askdb/core` README states the pre-release beta status accurately. `@askdb/ai`, `@askdb/ai-*`, `@askdb/mysql`, `@askdb/sqlite`, and `@askdb/sqlserver` now ship the `LICENSE` and `NOTICE` files their `package.json` `files` lists and READMEs already referenced.
