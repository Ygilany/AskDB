---
"@askdb/docs-site": patch
---

The CLI, configuration and packages reference pages match the code again (#713). The CLI reference gives the `init` defaults (`--database postgres`, `--connection-env DATABASE_URL`, `--ai-provider openai`), lists the commands that run without a config, adds Studio's `--version`, a `bundle` synopsis, the logging flags' config fallbacks and the `--schemas` default, and marks the experimental `studio`, `enrich`, `bundle` and `rag` commands and the `init` RAG and Studio flags (ADR 0030, #662). The packages page's dependency table now matches every `package.json`, and the configuration page names `resolveProviderOptions()` as a registry method.
