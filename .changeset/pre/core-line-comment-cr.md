---
"@askdb/core": patch
---

The SQL checks end a `--` comment where each engine does. Postgres and SQL Server end it at a carriage return (`\r`) as well as at `\n`; MySQL, MariaDB, SQLite and CockroachDB end it only at `\n`. The tenant check ended it only at `\n` under every dialect, so it could miss a table Postgres or SQL Server reads after a `\r`. The shared lexer ended it at `\r` everywhere, so the sensitive and tenant checks could read code on MySQL, MariaDB or SQLite as part of a string. A `postgres` dialect is read both ways, since it may point at CockroachDB. Built-in dialects refuse comments in the read-only check, so this reached `ask()` only through a custom `AskDialect`.
