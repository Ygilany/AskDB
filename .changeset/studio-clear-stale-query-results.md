---
"@askdb/studio": patch
---

Fix stale query results persisting when a new natural language query is submitted in the Playground.

Previously, `executeResult` was not cleared when a new question was asked, so the previous results table remained visible until the user manually clicked "Execute Query" again. Submitting a new question now atomically clears both the generated SQL and the execution results.

Refactored `playground-context` and `rag-context` to use named compound reducer actions (`start_ask`, `ask_succeeded`, `execute_completed`, `rag_build_completed`, `rag_query_completed`) instead of multiple sequential dispatches, so each logical state transition is atomic and clearly named.
