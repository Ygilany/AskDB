---
"askdb": patch
"@askdb/docs-site": patch
---

Every `askdb` command parses, documents and checks its flags the same way (#711). Each command's flags live in one table that both the parser and its `--help` read, so the help can't leave out a flag the command takes. `askdb` no longer depends on `commander`. Visible changes:

- **`askdb help <command>` prints exactly what `askdb <command> --help` prints.** `askdb init --help` now lists `--interactive`, `-f` and `-y`, which it accepted but didn't document.
- **Every command takes `--flag=value`**, `askdb init` and `askdb bundle` included.
- **`askdb init` errors stop repeating values that could be secrets.** An unknown option, a stray argument or an invalid value is repeated only when it looks like a name or a number, as in the other commands.
- **`askdb ask`'s usage errors read like the other commands'**: `Unknown option: --x` instead of `error: unknown option '--x'`, and `Missing --question <text>.` for a missing question. The exit code is still `1`.
- **`askdb --help`, `askdb ask --help` and `askdb rag --help` use the shared layout**, with every flag listed under `Options:`.
- **`askdb bundle --help` prints its help on stdout and exits `0`.** Without both `<schema-dir>` and `--out`, `bundle` still prints its usage line on stderr and exits `1`, and its flags may now come in any order.
- **A failed connection prints why** (#749). When a driver gives up on several addresses, such as `localhost` refusing on both `::1` and `127.0.0.1`, `askdb introspect` printed an empty line. It now prints each address's error on its own line, with any password in a URL masked.
