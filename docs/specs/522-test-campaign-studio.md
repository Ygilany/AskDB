# Spec: apply the studio test campaign's plan (#522)

## For the owner

This spec applies the studio test campaign's plan in one PR of test-only changes: one assertion that couldn't fail now can, seven duplicate Studio server tests fold into the tests that own their behavior, and the connection-label table drops from 38 rows to the 9 that prove Studio's wiring.

| Decision | Answer | Settled by | Undo |
| --- | --- | --- | --- |
| 1. Trim the Studio label table | Yes: keep the 9 Studio-wiring rows, retire the 29 parsing rows to the engine label tests (ADR 0011) | @Ygilany, grilling (Q1, option A) | Two-way: revert the PR |
| 2. One PR or two | One PR does all of the plan, including the execute-status `it.each` table | Triage, default D1; accepted by @Ygilany in grilling | Two-way |
| 3. The rest of the plan | As triage wrote it: `configured` asserted `false`, the C rows retired into their keepers with the `expectedDimensions: null` carry-over, no production code changed | @Ygilany, grilling | Two-way |

```text
apps/studio/src/server.test.ts
  execute status default test ── typeof configured "boolean"  ──▶  configured === false   [F repaired]
  "not configured, no URL" test ─────────────────────────────────▶  retired into the default test
  sqlserver / sqlite / mysql status tests (3) ───────────────────▶  one it.each table (3 rows)
  pgvector width-learning test (fake store) ─────────────────────▶  retired → integration test
  prisma no-schemaPath label test ───────────────────────────────▶  retired → prisma provider tests
  label it.each, 38 rows ────────────────────────────────────────▶  9 rows; 29 → engine label tests
apps/studio/src/server.pgvector.integration.test.ts
  after-first-index status matcher ──────────────────────────────▶  + expectedDimensions: null
```

**Risks:** a leak that only Studio's config path shows (not the engine parser) would have no direct Studio test; the owner accepted this in grilling. The pgvector keeper runs only where a pgvector database is set (CI's `test` job), so its carry-over is checked there, not locally.

**Done when:** each row the issue lists is repaired or retired into its named keeper with its carry-over; the label table has its 9 rows; `pnpm test` and `pnpm lint` pass with no production file changed.

**Needs you:** nothing.

Reply `approve`, or `/changes` with what to change.

## Problem Statement

The weekly test campaign read the Studio subsystem's tests and found tests that cost upkeep without adding proof. One execute-status test checks only that `configured` is a boolean, so it would pass if Studio reported a connection as configured when none is. Four execute-status tests repeat the same setup with one field changed, and one of them ("not configured when no connection URL is set") proves nothing the default test can't once its assertion is tightened. A server test of pgvector width learning runs against a fake store that only records the requested width, while a later real-Postgres integration test proves the same flow end to end. A server test of the prisma no-`schemaPath` label repeats the prisma provider's own test. And the label table in the server tests repeats 29 parsing edge cases that the engine label tests own. A maintainer changing label parsing has to edit both places, and a reader can't tell which tests prove Studio's own behavior.

## Solution

The Studio server tests keep one proof per Studio contract. The execute-status default test proves that a fresh config reports execute as off and not configured. One table proves that Studio reports the right provider, label, driver package, connection kind and `configured: true` for each non-default engine. The label table keeps only the rows that prove Studio passes each engine's connection through the registry to its HTTP response, plus the rows that are Studio's own. Every retired test names the test that keeps its proof, and that test stays green. No Studio response, server code or test-only seam changes.

## User Stories

1. As a maintainer, I want the execute-status default test to fail if `configured` becomes `true` for a config with no execute connection, so that a regression in the "is a connection set" check is caught.
2. As a maintainer, I want the "not configured when no connection URL is set" case covered by the default test, so that I don't keep a test whose name promises a contract its input doesn't exercise.
3. As a maintainer, I want the sqlserver, sqlite and mysql execute-status cases in one table, so that adding an engine is one row, not a copied test.
4. As a maintainer, I want each execute-status table row to assert `provider`, `label`, `packageName`, `connectionKind` and `configured: true`, so that the mysql case gains the `label` assertion it lacked.
5. As a maintainer, I want the sqlite row to assert `connectionKind: "file"`, so that Studio's file-versus-URL choice stays proven.
6. As a maintainer, I want pgvector width learning proven by the real-Postgres integration test alone, so that the fake-store copy doesn't pass while the real flow breaks.
7. As a maintainer, I want the integration test to assert `expectedDimensions: null` after a first index with no configured width, so that the one assertion only the fake-store test made is kept.
8. As a maintainer, I want the fake-store pgvector tests that nothing else covers (the mock embedder case and the message plus pool-close case) left in place, so that retiring one test doesn't lose their proof.
9. As a maintainer, I want the prisma no-`schemaPath` label proven by the prisma provider's tests, so that the label's owner holds its test.
10. As a maintainer, I want the Studio label table to keep one ordinary row per engine form Studio wires (postgres, mysql, mssql URL, ADO.NET string, sqlite path), so that Studio's pass-through of each engine to `/api/introspect/status` stays proven.
11. As a maintainer, I want the label table to keep one fallback row, so that a fallback label reaching the HTTP body stays proven.
12. As a maintainer, I want the leading-space row kept, so that Studio's config trimming (which the engine tests don't see) stays proven.
13. As a maintainer, I want both prisma rows kept, so that the prisma schema-path label, including the `?key=` fallback that has no engine twin, stays proven in Studio.
14. As a maintainer, I want the 29 parsing edge cases to live only in the engine label tests, so that a parsing change is made and reviewed in one place (ADR 0011).
15. As a maintainer, I want the label table's comments to describe only the rows that remain, so that the table doesn't claim coverage it no longer has.
16. As a reviewer, I want every retired test to name its keeper in the PR body, so that I can check no assertion was lost.
17. As a contributor, I want `pnpm test` and `pnpm lint` green after the change, so that the consolidation breaks nothing.
18. As a host app developer, I want no Studio response or behavior to change, so that this test cleanup needs nothing from me.

## Implementation Decisions

- **Test-only, two files.** The change touches the Studio server tests and the Studio pgvector integration test, and no production file. The test-only seams (`setStudioPgvectorStoreFactoryForTests`, `setStudioClientDirForTests`, `setSetupInstallerForTests`) stay: each is still used by a kept test (decision 3).
- **F repaired (decision 3).** In the execute-status default test (`GET /api/execute/status returns postgres provider when no execute provider is configured`), `configured` is asserted to be `false` in place of its type check. With the shared test config, execute is off and `useIntrospectionConnection` is not set, so Studio has no execute connection and reports `configured: false`. Every other assertion in that test (provider, label, package, connection kind, install command, `enabled: false` with its reason, `canInstallFromStudio`, timeout and row cap) stays.
- **"Not configured" test retired (decision 3).** `GET /api/execute/status reports not configured when no connection URL is set` is deleted; the repaired default test covers it. The "introspection URL present but not reused" contract stays with `POST /api/execute does not silently reuse the introspection connection`, which is untouched.
- **Execute-status table (decision 2, default D1, and decision 3).** The three tests for sqlserver, sqlite and mysql become one `it.each` table that keeps their configs (introspection on that engine with `studio.execute.enabled` and `useIntrospectionConnection` both `true`). Each row asserts:

  | Engine | Introspection connection | `provider` | `label` | `packageName` | `connectionKind` | `configured` |
  | --- | --- | --- | --- | --- | --- | --- |
  | sqlserver | `databaseUrl: "Server=localhost;Database=app;"` | `sqlserver` | `SQL Server` | `mssql` | `url` | `true` |
  | sqlite | `file: "./data/app.db"` | `sqlite` | `SQLite` | `better-sqlite3` | `file` | `true` |
  | mysql | `databaseUrl: "mysql://localhost/db"` | `mysql` | `MySQL` | `mysql2` | `url` | `true` |

  The labels and package names are the ones Studio's execute driver registry has today. Config-side resolution stays owned by the config package's tests.
- **pgvector width-learning server test retired (decision 3).** `learns a new pgvector table's width from the embedding model when none is configured` is deleted from the server tests. Its keeper is the integration test `creates a new table at the model's width, keeps it on rebuilds, and answers queries`, whose status matcher after the first index gains `expectedDimensions: null`. The other fake-store pgvector server tests stay.
- **Prisma no-`schemaPath` server test retired (decision 3).** `GET /api/introspect/status gives a prisma source with no schemaPath the generic label…` is deleted. Its keeper is the prisma provider test that resolves a runtime with no `schemaPath` to `sourceLabel: "configured prisma connection"`. Studio's prisma wiring stays proven by the label table's two prisma rows.
- **Label table trimmed to 9 rows (decision 1).** `GET /api/introspect/status labels %s %s as %s` keeps these rows, and only these, unchanged:

  | Engine | Input | Label |
  | --- | --- | --- |
  | postgres | `postgres://app:S3cret@db:5432/app?sslmode=require` | `postgres://db:5432/app` |
  | mysql | `mysql://root:S3cret@db:3306/shop` | `mysql://db:3306/shop` |
  | sqlserver | `mssql://sa:S3cret@db:1433/app` | `sqlserver://db:1433/app` |
  | sqlserver | `Server=db,1433;Database=app;User Id=sa;Password=p@ss/w#rd;` | `sqlserver://db:1433/app` |
  | sqlite | `./data/app.db` | `./data/app.db` |
  | postgres | `postgres://app:pa/ss@db:5432/app` | `configured postgres connection` |
  | postgres | ` postgres://app:S3cret@db:5432/app` (leading space) | `postgres://db:5432/app` |
  | prisma | `./prisma/schema.prisma` | `./prisma/schema.prisma` |
  | prisma | `file:schema.prisma?key=S3cret` | `configured prisma connection` |

  The other 29 rows are deleted; each has a twin in the engine label tests (postgres, mysql, sqlserver, sqlite) or the introspect registry test, which own label parsing under ADR 0011. The test body is unchanged.
- **Label table comments.** A comment line that describes only retired rows is deleted. A comment that names kept and retired rows is cut to what the kept rows show (the leading-space note keeps its "`@askdb/config` trims config values" line). The comment above the table says the table proves Studio's wiring of each engine to `/api/introspect/status`, and that the engine label tests own the parsing cases (ADR 0011), in place of its claim to hold every leaking input class.

## Testing Decisions

- **One seam, the existing one.** Every changed test drives Studio over HTTP: build the server with `createStudioServer`, listen, and read `GET /api/execute/status` or `GET /api/introspect/status` (the integration test reads the RAG status through its `studio.status()` and `studio.index()` helpers). No new seam, helper or fixture is added.
- **Good tests here** assert Studio's response, not how it computes it: the repaired assertion reads `configured` from the response body, and the table rows assert response fields.
- **Each test is gated with `factory-test-audit`.** The repaired default test must fail if `configured` comes back `true` (check by flipping the expectation once). The new `it.each` table must report one named case per engine.
- **Keepers are checked, not edited** (apart from the integration matcher): the engine label tests, the introspect registry test, the prisma provider test and the config tests must exist and pass as they are. The PR body lists each retired test or row with its keeper, and the reviewer spot-checks the label twins (the campaign checked them by script; triage did not re-run that).
- **Prior art:** the label table itself is the `it.each` shape the execute-status table follows; the execute-status tests already use `installStudioRuntime` with an `AskDbConfig` per engine.
- **The integration carry-over** runs only with `ASKDB_PGVECTOR_URL` or `PGVECTOR_URL` set; CI's `test` job runs it with `ASKDB_REQUIRE_INTEGRATION=1`. Build runs it locally if a pgvector database is reachable, and says in the PR body whether it did.

## Out of Scope

- The tenant-policy symlink write, already filed as #372.
- New tests for the gaps the campaign noticed: `cache-control: no-store`, `content-security-policy: frame-ancestors 'none'`, and `/assets/` path containment.
- Any production code change, and removing the test-only seams (all three are still used).
- Edits to tests outside `apps/studio`: the engine label tests, the prisma provider tests and the config tests are keepers only.
- A changeset: `apps/studio` test files are not published package output.

## Further Notes

- The label rows were mirrored into Studio on purpose during the #189 reviews (commit `c4eddc3e`). The owner chose to retire them in grilling, accepting that a leak only Studio's config path shows would have no direct Studio test.
- The campaign's size estimate is about 220 changed lines, almost all deletions.

## Ticket coverage

| Ticket item | Met by |
| --- | --- |
| Each `F` row repaired: its assertion can now fail | Implementation Decisions, "F repaired"; Testing Decisions (flip check) |
| Each `C` row consolidated into its keeper, with the carry-over assertions | Implementation Decisions, each "retired" item and the execute-status table; decision 3 |
| Each `D` row deleted, its remaining proof still passing | None in the plan (`D 0`); nothing to do |
| Each test-only seam the plan unlocks removed | None unlocked; Implementation Decisions, "Test-only, two files" |
| `pnpm test` and `pnpm lint` pass | Done when; Testing Decisions |
| Row `:643` pgvector width learning (C) | "pgvector width-learning server test retired", with `expectedDimensions: null` |
| Row `:739` execute-status default (F) | "F repaired" |
| Row `:762` sqlserver status (C) | Execute-status table, sqlserver row |
| Row `:786` sqlite status (C) | Execute-status table, sqlite row |
| Row `:810` not configured (C) | "Not configured test retired" |
| Row `:902` mysql status (C) | Execute-status table, mysql row (gains `label`) |
| Row `:1115` label table (29 C / 9 R) | "Label table trimmed to 9 rows", "Label table comments"; decision 1 |
| Row `:1209` prisma no-`schemaPath` (C) | "Prisma no-schemaPath server test retired" |
