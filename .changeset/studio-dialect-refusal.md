---
"@askdb/studio": minor
---

**Breaking:** Studio picks the dialect with `@askdb/client`'s `resolveDialect()`, so a schema whose `provider` has no AskDB dialect is refused, as the CLI and the HTTP API already refused it (#886, ADR 0039). The Playground answers `422` with the client's `DialectNotSupportedError` message and generates nothing, instead of PostgreSQL SQL checked under PostgreSQL's rules. The workspace still loads: its `dialect` is `null`, with the reason in `dialectError`, and the Get the code panel shows the reason instead of code. Set `dialect` in `askdb.config.ts` to the built-in dialect your engine speaks. `@askdb/studio` now depends on `@askdb/client`.
