# Spec: postgres: three introspection edge cases from the test campaign (#552)

## For the owner

This spec fixes three small `@askdb/postgres` introspection bugs that the test campaign found: quoted `text[]` literals split at commas inside quotes, the live and bundle paths disagree on which schemas are system schemas, and view columns keep input row order instead of `ordinal_position`.

| Decision | Answer | Settled by | Undo |
|---|---|---|---|
| Fix or close each item | Fix all three; each one reproduces | Triage (verification found all three hold) | Two-way: revert |
| Quoted array items | Commas inside `"…"` belong to the item, `\"` and `\\` unescape, unquoted `NULL` is null, other unquoted items are literal; arrays the runner already decoded pass through unchanged | Triage, Agent Brief (Desired behavior) | Two-way: revert |
| Which schemas are system schemas | Only `information_schema`, `pg_catalog`, `pg_toast`, `pg_temp_<n>` and `pg_toast_temp_<n>`, the same on the live and bundle paths. The live path's `_` is matched as a literal underscore. The bundle path also stops dropping `information_schema_<x>` and `pg_catalog_<x>` (it drops them today; live keeps them) | Triage, Agent Brief (Desired behavior, Key interfaces: "make them agree") | Two-way: revert |
| View column order | Sorted by `ordinal_position`, as table columns are | Triage, Agent Brief (Desired behavior) | Two-way: revert |
| Test seams | Item 1 through `foldIntrospectionResult`; item 3 through the fold or the from-export describe; item 2 through the from-export describe plus a live integration test gated on `DATABASE_URL` | Triage, Agent Brief (Acceptance criteria) | Two-way |

```
Live path (catalog SQL)                    Bundle path (export bundle)
SYSTEM_SCHEMA_PREDICATE                    isSystemSchema
  NOT LIKE 'pg_toast%'   ◀ FIX: `_` is a    information_schema / pg_catalog
  NOT LIKE 'pg_temp_%'      wildcard, so      exact OR "<name>_" prefix   ◀ FIX: exact only
  → drops "pgxtoast"        pgxtoast drops    → drops "information_schema_x"
                 \                                  /
                  ▼                                ▼
            foldIntrospectionResult  ──▶  SqlSchema
              index columns: normalizePgTextArray   ◀ FIX: honour quoted items
              view columns: built in row order      ◀ FIX: sort by ordinal_position
```

**Risks.** Output changes only for string-valued array literals with quoted items, for user schemas named like `pgxtoast` or `information_schema_x`, and for view rows given out of order. Real system schemas stay excluded on both paths. No public API or `SqlSchema` shape changes.

**Done when.** Each fix has a test that fails on `main` and passes after; the live check runs when `DATABASE_URL` is set; `pnpm --filter @askdb/postgres test` and `pnpm lint` pass; a patch changeset for `@askdb/postgres` names all three fixes.

**Needs you.** Nothing open. No defaults were taken.

Reply: `/approve` · `/changes <guidance>`

## Problem Statement

The `@askdb/postgres` test campaign (#514) read the connector's production code and found three places where introspection gives a wrong answer for inputs the live `pg` driver rarely produces but export bundles and custom runners do:

- An index's column list arrives as a Postgres array literal string when it comes from a CSV export bundle or a runner that doesn't decode `text[]`. The parser splits on every comma, so `{"a,b",c}` becomes `["\"a", "b\"", "c"]` instead of `["a,b", "c"]`.
- The live catalog queries exclude system schemas with `LIKE` patterns such as `'pg_toast%'`, where `_` matches any one character. A user schema called `pgxtoast` is therefore dropped when introspecting live but kept when the same database is read from an export bundle. The bundle path has its own mismatch the other way: it treats any `information_schema_<x>` or `pg_catalog_<x>` as a system schema, which the live path keeps. The same database gives a different `SqlSchema` depending on how it was read.
- Table columns are sorted by `ordinal_position`; view columns are not. A hand-built bundle whose column rows aren't in order gives views whose columns are out of order, which then shows up in the schema artifact, in RAG chunks and in prompts.

## Solution

Introspection of the same database gives the same `SqlSchema` whichever path read it:

- A string array literal is parsed the way Postgres writes it, so quoted items keep their commas, quotes and backslashes, and `NULL` means null only when unquoted.
- The live and bundle paths classify exactly the same schemas as system schemas: `information_schema`, `pg_catalog`, `pg_toast`, and the `pg_temp_<n>` / `pg_toast_temp_<n>` families. Any other name, including `pgxtoast` and `information_schema_x`, is a user schema on both paths.
- View columns come out in `ordinal_position` order, like table columns.

## User Stories

1. As a host developer introspecting from a CSV export bundle, I want an index on a column whose name contains a comma to list that column once, so that the schema artifact names the real index columns.
2. As a host developer, I want an index column whose name contains a double quote or a backslash to come through unescaped, so that the column name in the artifact matches the database.
3. As a host developer using a custom catalog runner that returns `text[]` as a string, I want the same index columns the `pg` driver path gives, so that switching runners doesn't change my schema.
4. As a host developer, I want an unquoted `NULL` item in an array literal to be treated as null and a quoted `"NULL"` to be the text `NULL`, so that an index on a column literally named `NULL` isn't lost.
5. As a host developer whose runner already decodes arrays, I want decoded arrays to pass through unchanged, so that the fix can't regress the common live path.
6. As a host developer with a schema called `pgxtoast`, I want live introspection to include it, so that its tables reach the schema artifact.
7. As a host developer with a schema called `information_schema_x`, I want bundle introspection to include it, so that it matches what live introspection already gives.
8. As a host developer, I want `information_schema`, `pg_catalog`, `pg_toast`, `pg_temp_<n>` and `pg_toast_temp_<n>` still excluded on both paths, so that system objects never enter the artifact.
9. As a host developer who produces a bundle live and then reads it back, I want both readings to keep the same schemas, so that from-export and live introspection are interchangeable.
10. As a host developer with a hand-built bundle, I want view columns ordered by `ordinal_position` whatever the row order, so that views read the same as tables.
11. As a maintainer, I want each fix pinned by a test that fails on `main`, so that a regression is caught.
12. As a maintainer without a local Postgres, I want the live system-schema check to skip without `DATABASE_URL` and fail under `ASKDB_REQUIRE_INTEGRATION=1`, so that CI still exercises it.
13. As a maintainer reading the changelog, I want one patch changeset naming the three fixes, so that I know what changed in introspection output.

## Implementation Decisions

- **Array literal parser** (the connector's private text-array normaliser used for index columns). Only the string branch changes. It reads a one-dimensional Postgres array literal item by item: a double-quoted item runs to its closing unescaped quote and may contain commas; inside it, a backslash escapes the next character (`\"` → `"`, `\\` → `\`); an unquoted `NULL` is null; any other unquoted item is taken as it stands. Non-string input, and strings that aren't wrapped in `{…}`, behave as today. The fold's existing handling of null items for index columns is unchanged.
- **Live system-schema predicate** (shared by every live catalog template). `information_schema` and `pg_catalog` stay exact matches. The `pg_toast` family is `pg_toast` exactly or `pg_toast_` followed by anything (which covers `pg_toast_temp_<n>`); the temp family is `pg_temp_` followed by anything. The underscore must be matched literally (an escaped `LIKE` underscore or an anchored regular expression both do it; the builder picks). The predicate must not drop more than it does today for real system schemas.
- **Bundle system-schema check**. `information_schema` and `pg_catalog` become exact matches; today they also match `<name>_…` as a prefix, so `information_schema_x` is dropped from bundles but kept live. The `pg_toast`, `pg_temp_` and `pg_toast_temp_` rules stay as they are; they already match the live rules above.
- **Agreement, stated once.** After the change, for every schema name both paths answer the same "is system" question. Names starting `pg_` other than the system ones (`pg_toastfoo`, `pg_catalog_x`) can't be created in Postgres, which reserves the prefix, so the two paths needn't be checked against each other for them.
- **View columns** in the fold are sorted by `ordinal_position` before they are built, the same comparison the table branch uses. Nothing else about views changes.
- **Changeset**: one patch changeset for `@askdb/postgres` describing the three fixes, including the bundle path's `information_schema_<x>` change.

## Testing Decisions

- Tests assert on introspection output (`SqlSchema` schemas, index columns, view columns), never on the template SQL text (out of scope per triage).
- **Item 1**: through `foldIntrospectionResult`, with an index row whose `columns` is a string literal. Cases: `{"a,b",c}` → `["a,b", "c"]`; escaped quote and backslash in quoted items; unquoted `NULL` dropped or null as the fold treats it today while quoted `"NULL"` stays text. The fold's input type says decoded arrays, so the test casts the string; that cast stands for what bundles and string-returning runners pass. At least the `{"a,b",c}` case fails on `main`.
- **Item 3**: out-of-order view column rows (`ordinal_position` 2 then 1) come out in position order. Through the fold, or through the from-export describe with a CSV bundle; fails on `main`.
- **Item 2, bundle path**: through `createPostgresConnector().describe({ mode: "from-export" })` with a CSV bundle that adds `information_schema`, `pg_catalog`, `pg_toast`, `pg_temp_<n>`, `pg_toast_temp_<n>`, `pgxtoast` and `information_schema_x`, each with a table. Only the user schemas (`pgxtoast`, `information_schema_x`) and the fixture's own schemas remain. The `information_schema_x` case fails on `main`.
- **Item 2, live path**: an integration test that creates `pgxtoast` with a table, introspects live, asserts `pgxtoast` is present and `information_schema`, `pg_catalog`, `pg_toast` absent, and drops the schema afterwards. It uses the repo's integration-suite helper, so it skips without `DATABASE_URL` and fails under `ASKDB_REQUIRE_INTEGRATION=1`. It fails on `main` when run against a database.
- Prior art: `describe.test.ts` (fold-level tests built from row literals), `bundle.test.ts` (`writeCsvBundle` with the `orders-users` fixture), and the connector's other `*.integration.test.ts` files.
- Each new test goes through `factory-test-audit` at build.

## Ticket coverage

| Ticket item | Met by |
|---|---|
| Issue "Done when": each item reproduced with a failing test and fixed, or closed with the reason | All three hold (triage verification); Implementation Decisions and Testing Decisions, one fix and one failing-first test each |
| Triage AC: `{"a,b",c}` yields `a,b` and `c`; quoted commas, escaped quotes, `NULL` and unquoted items keep working | Implementation Decisions, Array literal parser; Testing Decisions, Item 1 |
| Triage AC: `pgxtoast` kept on the live path as the bundle path keeps it; real system schemas dropped on both | Implementation Decisions, Live predicate, Bundle check and Agreement; Testing Decisions, Item 2 (bundle and live) |
| Triage AC: view columns ordered by `ordinal_position` regardless of row order | Implementation Decisions, View columns; Testing Decisions, Item 3 |
| Triage AC: each fix has a test that fails before and passes after | Testing Decisions, each item names its failing-on-`main` case |
| Brief AC: `pnpm --filter @askdb/postgres test` and `pnpm lint` pass; patch changeset added | Implementation Decisions, Changeset; For the owner, Done when |

## Out of Scope

- #239: which schemas an unfiltered introspection includes by default.
- Other engines' system-schema rules.
- Any change to the `SqlSchema` shape or the export bundle format.
- Tests that assert on the template SQL text.
- Multi-dimensional or malformed array literals (an unterminated quote, say): index column lists are one-dimensional and Postgres writes them well-formed, and the ticket asks for no behaviour there.
- Docs changes: `docs/integration/connectors.md` and the `IntrospectionFilters` doc comment describe the system schemas as `pg_toast*` and `pg_temp_*`, which stays accurate because user schemas can't start with `pg_`.

## Further Notes

- The quick-lane build already pushed an implementation and tests on this branch (draft PR #556) before its diff tripped the quick lane's budget and moved the ticket to the standard lane. That work covers items 1 and 3 and the live half of item 2. It does not yet make the bundle path's `information_schema` / `pg_catalog` matching exact, its bundle test doesn't include `information_schema_x`, and the changeset doesn't mention it. The standard build checks the branch against this spec and closes that gap.
- Postgres rejects `CREATE SCHEMA` for names starting `pg_` ("the prefix pg_ is reserved for system schemas"), which is why `pgxtoast`, not `pg_toastx`, is the live test's schema.
