---
"@askdb/docs-site": patch
---

Troubleshooting moves to `/guides/troubleshooting/` as "Fix common errors", and the old URL redirects there (#713). Each heading now names a message AskDB prints: the missing-schema and invalid-`schema.json` errors show the CLI's and the library's real text, and the page adds `no AI API key configured`, the missing `@ai-sdk/*` peer, and `SqlGenerationError: Model call failed` with what 401 and 404 mean. It drops `askdb enrich` as a headless command (it opens Studio), the claim that `OPENAI_MODEL` belongs in the config file, the table `description:` key and the "expected SQL" table section, none of which exist. Studio's execute errors quote the Playground's messages. The RAG section lists each reason `ask()` skips retrieval, and its sample passes the `store` that `buildSchemaIndex()` requires.
