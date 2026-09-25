---
---

chore(ci): run the database integration suites in CI. Turbo's `test` task now passes the integration env vars through (strict env mode was dropping them, so every DB suite skipped), CI sets `ASKDB_REQUIRE_INTEGRATION=1` so a missing URL or driver fails instead of skipping, and the pgvector suite runs against a `pgvector/pgvector:pg16` service. Test-only; no published package code changes.
