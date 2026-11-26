# Adding a new engine's dialect rules

[ADR 0029](../adrs/0029-core-owns-built-in-dialect-specs.md) decides that `@askdb/core` owns the SQL rules of the built-in dialects. This page is the how-to that follows from that decision: what to change when a new engine family joins, and how the rules stay honest afterwards.

## How a new engine adds its rules

**A first-party engine** is a change to core plus a new engine package.

- **In core:**
  - Add its id to `DialectId`, and its spec to [`dialect-spec.ts`](../../packages/core/src/sql/dialect-spec.ts) and `BUILT_IN_DIALECTS`. Add the id to `ASKDB_DIALECTS` in `@askdb/config` ([`packages/config/src/constants.ts`](../../packages/config/src/constants.ts)) too, so `askdb.config` accepts it.
  - A new id also needs a new ADR ([ADR 0029](../adrs/0029-core-owns-built-in-dialect-specs.md), Keep table: the built-in ids are exactly the six), an update to the exact-ids assertion in [`dialect-spec.test.ts`](../../packages/core/src/sql/dialect-spec.test.ts) (the `allIds` array, compared against `SUPPORTED_DIALECT_IDS`), and a pass over the docs that say "six" ([`architecture.md`](../architecture.md), the docs-site `concepts/modes-and-dialects.mdx` and `reference/core-api/dialects.mdx`) so the count stays true.
  - Add its reserved words to [`reserved-words.ts`](../../packages/core/src/sql/reserved-words.ts). Write a source comment (the document and the date fetched) and a `Checked` comment (the server versions it was checked against) above the list.
  - Add its cases to the switches on `id`: the lexer profile, the prompt quoting, the parameter markers in [`bind.ts`](../../packages/core/src/sql/bind.ts), the SELECT modifiers in [`sensitive-guardrail.ts`](../../packages/core/src/sql/sensitive-guardrail.ts) and the readings each SQL check uses ([`readings.ts`](../../packages/core/src/sql/readings.ts), which holds the tenant check's code readings, `tenantCodeReadings`, since [#815](https://github.com/Ygilany/AskDB/issues/815)). Only the parameter markers fail the type check when a case is missing. The others fall back without an error, and the tenant check falls back to a standard-SQL reading, which a MySQL-family engine reads differently ([#661](https://github.com/Ygilany/AskDB/issues/661)).
- **In its engine package:**
  - Build the connector, catalog SQL and driver loading on the engine kit ([ADR 0008](../adrs/0008-engine-packages-and-connector-registry.md)).
  - Re-export its spec.
  - When the engine joins the multi-engine fixture, check its reserved words against the server.

**A third-party engine** needs no AskDB change, but it gets no string id.

- An engine that speaks a built-in family's SQL can spread that spec and pass the object to `ask()`: `{ ...POSTGRES_DIALECT, displayName: "…", promptBrief: "…" }`. It keeps the family's `id`, so it keeps that family's lexing, quoting and markers. Any list it sets replaces the family's list.
- The spread spec's own rules hold in `ask()` only. `PreparedQuery` records just the `id`, so `bindPreparedQuery()` and `askdb.bind()` check and render under the built-in family's spec, without the host's lists, `extraValidate` or `backslashEscapes` ([#660](https://github.com/Ygilany/AskDB/issues/660)). `ask()` records `dialectRules`, so a rebind runs under the spec the host passes as `dialect` and refuses a template made under a spread spec without it ([ADR 0032](../adrs/0032-rebind-checks-under-the-hosts-dialect-spec.md)).
- Any other engine implements `AskDialect`, the escape hatch. `ask()` doesn't run the read-only validator on an `AskDialect`'s SQL, so the engine calls `validateSelectSql` itself.
- A `DialectSpec` with a new `id` needs a change to core, because `DialectId` is closed. `ask()` refuses one passed from JavaScript or through a cast, with `UnknownDialectError`, before any check or model call ([#717](https://github.com/Ygilany/AskDB/issues/717)). A direct `validateSelectSql()`, `validateTenantGuardrails()` or `generateSelectSql()` call still accepts one and reads its SQL every engine's way, which fails closed.
- It introspects through its own `ConnectorProviderAdapter`, registered in a host's connector registry ([ADR 0008](../adrs/0008-engine-packages-and-connector-registry.md)).

## Keeping the rules honest

The rules are of two kinds, and each kind is checked against its own source of truth.

- **What the engine reserves** is a fact about the server, and it changes with the server version. Core holds these lists because the prompt needs them with only core installed. Each list names its source and the server versions it was checked against. A list may hold words the server doesn't reserve, because quoting a name that isn't reserved changes nothing. A word missing from a list reaches the model unquoted, and the model can copy it bare into SQL the server rejects.
- **What AskDB rejects** is core's own rule: the read-only denylist, and each spec's forbidden keywords and blocked functions. The prompt quotes these words too. For example, no engine reserves `copy`, but `validateSelectSql` rejects it unquoted. Core's own tests cover these rules.

Each engine package will check the reserved words of the spec it re-exports against its own server, in its multi-engine fixture suite. Those suites run in CI's integration job with `ASKDB_FIXTURE_HOST` set. The engine package already has the driver, so core gets no driver, not even as a dev dependency.

- **PostgreSQL:** each word from `pg_get_keywords()`, tried as a bare column name.
- **MySQL and MariaDB:** each word from `information_schema.KEYWORDS`, tried as a bare column name. MariaDB's table has no reserved flag, so trying each word is the only test.
- **The check fails** when the server rejects a word the list doesn't hold. A listed word the server accepts is not a failure.
- **SQL Server and SQLite** publish no keyword catalog in SQL, so their lists come from the vendor docs alone. CockroachDB isn't in the fixture; its extra words come from its parser source.

[#632](https://github.com/Ygilany/AskDB/issues/632) builds this check. Until it lands, the lists carry the manual check of 2026-10-05. When the fixture moves to a new server version, the check shows the words that version added, and a core release adds them.
