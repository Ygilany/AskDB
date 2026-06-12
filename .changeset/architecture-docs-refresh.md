---
---

docs: bring architecture guide in line with the shipped package layout

Add `@askdb/connectors`, `@askdb/mysql`, `@askdb/sqlite`, and `@askdb/sqlserver` to the
package-map diagram, dependency-boundaries diagram, and package table in `docs/architecture.md`.
Add AI adapter boundary rules and an AI provider adapter extension point. Flip ADR 0006 and
ADR 0007 from Proposed to Accepted and document the adapter-contract v2 changes in an ADR 0006
amendment. Remove false Bedrock/Ollama recipe claims from `README.md` and `docs/platform.md`.
