---
"@askdb/docs-site": patch
"@askdb/client": patch
---

The `@askdb/core`, `@askdb/client` and CLI reference pages now match source (#287). The core and client pages each have an Errors section that lists every error class, its fields, and every rule and reason code. A new `test:errors` check fails the docs-site tests when a class or code in `errors.ts` is missing from its page. The client page names `AskDbClient` and `DialectResolution`, adds `reasoningEffort` and `sensitiveGuardrailMode`, and says what the client caches. The CLI page drops exit code `2`, which no command uses, and adds `askdb introspect templates`, the `askdb ask` output format, glob matching for `--tables`, and the `rag index` and `rag query` output. The `@askdb/client` README says that `reload()` resolves again from the config snapshot the client was created with, so a changed config needs a new client.
