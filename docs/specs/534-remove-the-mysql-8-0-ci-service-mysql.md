# Spec: remove the mysql:8.0 CI service, MYSQL_DATABASE_URL and fixtures/mysql (#534)

## For the owner

This spec removes the `mysql:8.0` service and `MYSQL_DATABASE_URL` from CI's `test` job, the env entry from `turbo.json`, the `fixtures/mysql/` compose file, and the three doc mentions of them, now that #533 retired the only test that used them.

| Decision | Answer | Settled by | Undo |
| --- | --- | --- | --- |
| 1. When to do this | After #533 merged, against `main` (#533 merged 2026-10-25 18:55 UTC) | Owner's delegate, note at triage (2026-10-25) | Two-way |
| 2. Scope | Exactly the infra #515's spec listed as freed: the CI service and env entry, the `turbo.json` entry, `fixtures/mysql/`, the `CONTRIBUTING.md` row, the `docs/agents/code-review.md` mentions. Not `sqlserver`/`MSSQL_DATABASE_URL` (#295) | #515 spec decision 4, as filed in this issue; triage's acceptance criteria | Two-way |

```text
.github/workflows/ci.yml   test job
  services: postgres · ✗ mysql (mysql:8.0, 3306) · sqlserver
  env:      ASKDB_FIXTURE_HOST · ✗ MYSQL_DATABASE_URL · MSSQL_DATABASE_URL
turbo.json                 test.env  ✗ MYSQL_DATABASE_URL
fixtures/mysql/            ✗ deleted (docker-compose.yml)
CONTRIBUTING.md            Integration Tests table  ✗ MYSQL_DATABASE_URL row
docs/agents/code-review.md ✗ MYSQL_DATABASE_URL in the env-var list
                           ~ "Postgres, MySQL, SQL Server services" → "Postgres and SQL Server services"
```

**Risks:** `ci.yml` is a sensitive path, which is why the quick-lane build tripped into this lane. If any suite still read `MYSQL_DATABASE_URL`, `ASKDB_REQUIRE_INTEGRATION=1` would turn its skip into a red `test` job; a tracked-file grep finds no reader.

**Done when:** the five places no longer mention the service or the variable, a tracked-file grep outside `docs/specs/` finds none of `MYSQL_DATABASE_URL`, `fixtures/mysql`, `mysql:8.0`, and CI's `test` job is green on the PR.

**Needs you:**

> **Reading: the grep check excludes all of `docs/specs/`.** Triage's criterion says the grep should find only `docs/specs/515-test-campaign-mysql.md`, but this spec sits in `docs/specs/` and names what it removes, so that can't hold. Recommendation: accept the reading, the check is `git grep` over tracked files outside `docs/specs/`. The issue's own "Done when" (the five places no longer mention it) is unchanged.

Reply `approve`, or `/changes` with what to change.

## Problem Statement

#515 (PR #533) retired `@askdb/mysql`'s `exec/mysql.integration.test.ts`, the only suite gated on `MYSQL_DATABASE_URL`. MySQL and MariaDB live coverage now comes from the multi-engine fixture through `ASKDB_FIXTURE_HOST`. The infra that served the retired suite is still there: every CI `test` run starts a `mysql:8.0` container nothing connects to, `turbo.json` still passes the variable through, `fixtures/mysql/` still ships a compose file, and `CONTRIBUTING.md` and the code-review profile still tell contributors and reviewers that the variable gates a suite. Contributors read those docs and start a database they don't need; reviewers check for a variable that no longer matters.

## Solution

Delete the service, the variable and the fixture, and remove each doc mention, so CI starts only the databases its tests use and the docs describe the integration setup as it is.

## User Stories

1. As a maintainer, I want CI's `test` job to stop starting a `mysql:8.0` container, so that each run spends no time or runner resources on a database nothing uses.
2. As a maintainer, I want `MYSQL_DATABASE_URL` gone from the `test` job's env, so that the job's env lists only variables some suite reads.
3. As a maintainer, I want `MYSQL_DATABASE_URL` gone from the `test` task's `env` in `turbo.json`, so that Turbo's strict env list matches the variables tests gate on.
4. As a contributor, I want `fixtures/mysql/` gone, so that I don't start a MySQL 8.0 container expecting it to run a suite.
5. As a contributor, I want the `CONTRIBUTING.md` "Integration Tests" table to have no `MYSQL_DATABASE_URL` row, so that the table lists only variables that gate a suite.
6. As a contributor running `@askdb/mysql`'s live tests, I want the docs to point me only at the multi-engine fixture (`ASKDB_FIXTURE_HOST`), so that I set up the one fixture that covers MySQL and MariaDB.
7. As a reviewer using `docs/agents/code-review.md`, I want its env-var list to omit `MYSQL_DATABASE_URL`, so that I don't check a PR for a variable no test reads.
8. As a reviewer, I want the code-review profile's description of the `test` job's services to match `ci.yml`, so that the profile doesn't claim a MySQL service CI no longer starts.
9. As a maintainer, I want the `postgres` and `sqlserver` services, `ASKDB_FIXTURE_HOST` and `MSSQL_DATABASE_URL` left untouched, so that this change can't break the suites they serve.
10. As a maintainer, I want the `test` job to stay green with `ASKDB_REQUIRE_INTEGRATION=1`, so that I know no suite still depended on what was removed.
11. As a maintainer, I want `docs/specs/515-test-campaign-mysql.md` left as written, so that the record of why the suite was retired stays accurate to its time.

## Implementation Decisions

- **Order (decision 1).** The removal lands only after #533, because before it the retired suite still read `MYSQL_DATABASE_URL` and CI's `ASKDB_REQUIRE_INTEGRATION=1` would have failed the `test` job. #533 merged on `main` on 2026-10-25; the branch is based on that `main`.
- **Scope (decision 2).** The removal covers exactly what #515's spec named as freed by the retirement (its decision 4) and this issue lists:
  - the `test` job's `mysql` service container (`mysql:8.0`, port 3306, its env and health check) and its `MYSQL_DATABASE_URL` env entry;
  - `MYSQL_DATABASE_URL` in the `test` task's `env` list in `turbo.json`;
  - the `fixtures/mysql/` directory, whose only file is its compose file;
  - the `MYSQL_DATABASE_URL` row of `CONTRIBUTING.md`'s "Integration Tests" table;
  - `docs/agents/code-review.md`'s mentions: `MYSQL_DATABASE_URL` in the list of env vars some tests need, and "MySQL" in the description of the `test` job's services, which becomes "Postgres and SQL Server services". The issue's "Done when" asks that these places no longer mention the MySQL service, so the services description is part of the same edit.
- **What stays.** The `postgres` and `sqlserver` services, `ASKDB_FIXTURE_HOST`, `MSSQL_DATABASE_URL`, `fixtures/multi-engine` and `fixtures/sqlserver` are untouched. The comment above `ASKDB_FIXTURE_HOST` in `ci.yml` naming MySQL and MariaDB refers to the multi-engine fixture and stays. The consumer lab's isolated MySQL ports are its own config and stay.
- **No package change.** No publishable package is touched, so there is no changeset and no `apps/docs-site` change; `docs/agents/code-review.md` is outside the docs site.
- **Implementation already on the branch.** The quick-lane build committed the removal (`e9d891a0`, PR #540) before the sensitive-path tripwire on `ci.yml` moved the ticket to this lane. Build checks that commit against this spec rather than redoing it.

## Testing Decisions

- No new test. The change removes CI infra and docs; the behaviour to prove is that nothing depended on them, and the existing suite under CI's `ASKDB_REQUIRE_INTEGRATION=1` proves that: a suite still gated on `MYSQL_DATABASE_URL` would turn its skip into a failure.
- **The checks:**
  - CI's `test` job on the PR is green, which runs every `*.integration.test.ts` with `ASKDB_FIXTURE_HOST` and the remaining services set.
  - `git grep -n "MYSQL_DATABASE_URL\|fixtures/mysql\|mysql:8.0" -- . ':!docs/specs/'` prints nothing. The check covers tracked files only, so the factory's untracked `.factory/tmp/` notes don't count, and it excludes `docs/specs/`, where `515-test-campaign-mysql.md` keeps its historical wording and this spec names what it removes. The issue's own wording ("those five places no longer mention…") is met by this check; triage's stricter "finds only `docs/specs/515-…`" can't hold once this spec is on the branch.
  - `pnpm lint` and `pnpm test` pass locally (no live database needed for the unit suites).
- **Prior art:** #515's spec used the same pattern: delete a suite, prove it with CI's `test` job under `ASKDB_REQUIRE_INTEGRATION=1`.

## Ticket coverage

| Issue "Done when" / triage acceptance criterion | Met by |
| --- | --- |
| The five places no longer mention the MySQL service or `MYSQL_DATABASE_URL` | Implementation Decisions, Scope (decision 2) |
| `ci.yml`'s `test` job has no `mysql:` service and no `MYSQL_DATABASE_URL` entry; `postgres`, `sqlserver` and `ASKDB_FIXTURE_HOST` untouched | Scope (decision 2), What stays |
| `turbo.json`'s `test` task `env` has no `MYSQL_DATABASE_URL` | Scope (decision 2) |
| `fixtures/mysql/` is deleted | Scope (decision 2) |
| `CONTRIBUTING.md`'s "Integration Tests" table has no `MYSQL_DATABASE_URL` row | Scope (decision 2) |
| `docs/agents/code-review.md` no longer lists `MYSQL_DATABASE_URL` | Scope (decision 2) |
| Repo-wide grep finds only `docs/specs/515-test-campaign-mysql.md` | Testing Decisions, the `git grep` check (excludes `docs/specs/`, which now also holds this spec) |
| CI's `test` job is green without the `mysql:8.0` service, with `ASKDB_REQUIRE_INTEGRATION=1` | Testing Decisions, CI's `test` job |

## Out of Scope

- The `sqlserver` service and `MSSQL_DATABASE_URL` (#295).
- `fixtures/multi-engine` and its compose file.
- The historical wording in `docs/specs/515-test-campaign-mysql.md`.
- Any change to `@askdb/mysql` or its tests.

## Further Notes

Related: #515, #533, #295. PR: #540.
