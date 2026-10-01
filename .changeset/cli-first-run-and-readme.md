---
"askdb": patch
"@askdb/core": patch
---

**CLI: `--help` / `--version` work without a config; friendly missing-config error.**

- `askdb` no longer loads `askdb.config.*` before parsing arguments, so `askdb --help`, `-h`, `--version`, `-V`, `help`, no-args, `init`, `bundle`, `introspect --help`, and `introspect templates` all work in a directory without a config. Commands that read config (`ask`, `introspect`) load it lazily.
- `askdb --version` / `-V` is now supported and prints the package version.
- When a command needs config and none exists, the CLI prints `No askdb.config.* or .config/askdb.* found in <cwd>. Run \`npx askdb init\` to create one.` and exits 1, with no stack trace. Other uncaught errors (for example a config that fails to load) print their message and a hint; set `ASKDB_DEBUG=1` (or `true`) to include the stack trace. Other values, including `0`, and the `debug` package's `DEBUG` variable leave it off.
- `askdb studio` / `askdb enrich` warn when `askdb.config.*` exists but fails to load, instead of ignoring it silently.

**Docs:** the `@askdb/core` README states the pre-release beta status accurately.
