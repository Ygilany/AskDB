---
"@askdb/docs-site": patch
---

Start and Concepts pages match the code again (#713). The Quickstart shows the config `askdb init` really writes (`env("DATABASE_URL")`, not `SQLSERVER_URL`) and the questions its wizard asks. Install no longer says `askdb` alone can introspect: it needs the database's driver, which `askdb init` installs. How AskDB works says who loads the schema, when retrieval runs (a retriever always retrieves unless you pass the chunk count), and what `ask()` returns. Modes and dialects says what a dialect really controls and lists all six built-in dialects, with MariaDB on the home page too.
