---
"@askdb/studio": patch
---

Clean up the Query Playground's Explain section: it's now collapsed by default (was always expanded, pushing "Get the code" and "Execute Query" down the page), and the guardrail check output renders as a statement-kind chip plus a checkmark list instead of a raw JSON dump. Unrecognized explain shapes still fall back to the raw JSON view.
