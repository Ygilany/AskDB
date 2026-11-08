---
"@askdb/config": minor
---

**Breaking:** `bootstrapAskDbRuntime`, an alias of `bootstrapAskDbEnv`, is removed, and `ASKDB_CONFIG_EXTENSION_PRECEDENCE`, `DEFAULT_HTTP_API_REQUEST_TIMEOUT_MS`, `DEFAULT_PGVECTOR_INDEX_STRATEGY`, `DEFAULT_MOCK_RAG_EMBEDDING_DIMENSIONS`, `DEFAULT_STUDIO_EXECUTE_MAX_ROWS` and `DEFAULT_STUDIO_EXECUTE_TIMEOUT_MS` are no longer exported (#654): nothing outside `@askdb/config` used them, so they leave before 1.0 (ADR 0031). Call `bootstrapAskDbEnv()`, and read resolved values from `getAskDbRuntimeConfig()`. The not-initialized error now names only `bootstrapAskDbEnv()`. On the experimental `@askdb/config/scaffold` entry point, `renderAskDbAiConfigScaffold` and the types `AskDbAiConfigScaffold` and `AskDbScaffoldEnvVar` are no longer exported: `planAskDbScaffold` renders the `ai` block. The upgrade guide's beta.52 section lists each replacement.
