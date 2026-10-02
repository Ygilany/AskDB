---
---

docs(site): update docs-site to match post-adapter-contract AI architecture

- `reference/packages.mdx`: `resolveAiConfig`/`resolveEmbeddingConfig` now documented as registry methods (`registry.resolveAiConfig(env)` / `registry.resolveEmbeddingConfig(env)`); added `resolveBaseConfig` and `withEmbeddingProviderOptions` rows; added `@askdb/ai-anthropic` to the adapter install list with peer-dependency note and open-adapter-contract summary
- `reference/config.mdx`: annotated `ANTHROPIC_API_KEY` and `OPENAI_MODEL` rows with their default model values; added **Custom providers** section documenting `providerConfig.custom.{apiKey,baseUrl,model}` → `ASKDB_AI_API_KEY` / `ASKDB_AI_BASE_URL` / `ASKDB_AI_MODEL` with an escape-hatch example
- `quickstart.mdx`: expanded provider comment to enumerate known literals (`"openai" | "azure" | "foundry" | "google" | "anthropic"`) and note the custom-string option
- `install.mdx`: adapter install block now shows all four first-party adapters as commented alternatives with peer-dep note
- `guides/bring-your-own-model.mdx`: updated retired Anthropic model id `claude-3-5-sonnet-latest` → `claude-sonnet-4-6`
