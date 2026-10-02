# ADR 0016 — AI config: provider connections and per-use model sections

## Status

Accepted (2026-10-02, maintainer decision). Not implemented yet: the plan is #435, which also fixes the RAG key leak in #345.

## Context

`askdb.config` configured embeddings in the `rag` block. Its one branch, `rag.embedderConfig.openai`, was required by both the `openai` and `ai-sdk` embedders, and an unset model meant `text-embedding-3-small` whatever the provider. The layers under the config were already provider-neutral: `@askdb/rag` takes any AI SDK embedding model, and `@askdb/ai` treats embedding as one use of a provider (`AiUsage = "language" | "embedding"`). Every built-in adapter except Anthropic's builds embedding models; Anthropic has no embeddings API, so its adapter throws. The mismatch caused #345. With `ai.provider: "google"` and `rag.embedder: "ai-sdk"`, Studio sent the key from the OpenAI branch to Google and asked Google for an OpenAI model.

The `ai` block had a second problem. `ai.providerConfig.<provider>` mixed a provider connection (key, endpoint, resource, API version) with the language model choice (`model`, and Azure's `modelFamily`). A provider used only for embeddings had nowhere clean to go, and one provider couldn't have two connections, for example an Azure embedding deployment on a different resource than the language deployment.

## Decision

- `ai.providerConfig.<provider>` holds provider connections only. Each value is one connection or an array of them. A connection's `name` defaults to `"default"` and is unique within its provider. Keys stay provider ids, custom providers included, so `providerConfig.custom` goes away.
- The model choice moves into one section per use: `ai.language` (`provider?`, `connection?`, `model?`, `modelFamily?`, `reasoning?`) and `ai.embedding` (`provider?`, `connection?`, `model`, `dimensions?`).
- `ai.provider` becomes an optional default for both sections. A section's provider is `section.provider ?? ai.provider`, and its connection is `section.connection ?? "default"`, looked up within that provider. A section that resolves to no provider, or to a connection that doesn't exist, fails at load.
- The language model keeps a per-provider default. The embedding model is required whenever `rag.embedder` is `"ai"`, and no layer picks one: `@askdb/ai`'s `defaultEmbeddingModel` is deprecated too.
- Dimensions live only in `ai.embedding.dimensions`. They're required when AskDB doesn't know the model's width and the store needs it up front (pgvector).
- `rag` keeps what belongs to retrieval: `embedder: "mock" | "ai"` and the store.
- Old keys are translated at load with a warning and removed at the 1.0 cutover. The translation carries a legacy embedding key or base URL only to openai, azure, foundry or gateway; for any other provider, loading fails and the error shows the replacement block.

## Options considered

- **Embeddings stay under `rag`, with their own provider and key (`rag.embedderConfig.ai`, #345's original plan).** Rejected: a second place for the same secret, and RAG keeps a provider resolution of its own next to `ai`'s.
- **An `embeddingModel` field inside each provider branch.** Rejected: one choice split across two places, and the connection and the model choice stay mixed.
- **No top-level default: `provider` required in every section.** Rejected: every existing config would have to migrate `ai.provider`.
- **No top-level default: a section's provider is inferred from the only connection.** Rejected: adding a second connection would break a section the user didn't edit.
- **Named connections as `providerConfig` keys, each with a `provider` field.** Rejected: keys would stop being provider ids, so entries would lose their per-provider types. Connection lists keep them.
- **Connection names global across providers.** Rejected: the name would become a second way to choose a provider, which could contradict `section.provider`.
- **A default embedding model per provider.** Rejected: the model is baked into a persisted index (the embedder id and the vector width), so a default that changes, or a model the provider retires, invalidates every index built on it. On Azure the model is a deployment name, so a default is a guess.
- **Remove the old keys and ship a codemod.** Rejected: published betas carry the old shape, and a codemod would have to make the same ambiguous call the translation makes.

## Consequences

- Changing a section's provider while its `model` stays explicit pairs that model id with the new provider. Config loading can't catch this, because AskDB can't validate every provider's model ids, so it fails at the first model call, and that error should name the section and the provider. Before, the language model sat inside its provider's branch, so changing `ai.provider` couldn't mis-pair it.
- The flat env map can't hold two connections for one provider, so each section gets an env view of its own. `rt.ai.aiEnv` stays the language view.
- The type can't require the connection a section points at. It's a load-time check, as `requireProviderBranch` already was: known provider names also fit the custom branch, so a missing branch never failed to compile.
- Studio embedder ids change for setups that don't use OpenAI, which forces a one-time reindex.
