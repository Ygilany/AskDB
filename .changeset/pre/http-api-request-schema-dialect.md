---
"@askdb/http-api": minor
---

A request `schemaJson` gets SQL for its own engine (#809). The server generated and checked SQL for the `dialect` in `askdb.config.*` whatever a request schema's `provider` recorded, so a server configured for `postgres` returned PostgreSQL SQL, checked under PostgreSQL's rules, for a schema that recorded `mysql`. The server now passes a request schema's `provider` to `ask()` as its dialect, so generation and the read-only, tenant and sensitive checks run under that engine; the config's `dialect` applies to the server's own schema only. A request schema that records no `provider`, or one AskDB has no dialect for, answers `400 bad_request` with a message that names the provider (or says there is none) and the supported dialect ids, whether or not the config sets `dialect`. A caller that relied on the server's `dialect`, such as one sending a MariaDB artifact (which records `mysql`) to a server set to `mariadb`, now gets SQL for the recorded engine.
