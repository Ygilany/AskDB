# AskDB

AskDB turns a natural-language question into SQL for a host app's database, guided by an enriched schema artifact. It returns SQL and never executes it.

## Language

### AI models

**Provider connection**:
One named set of credentials and endpoint settings for an AI provider. A provider usually has one connection, shared by its language and embedding models; it can have several, so each model can use a different one.
_Avoid_: credentials

**Language model**:
The model AskDB uses to generate text: NL-to-SQL generation and enrichment suggestions.
_Avoid_: chat model, generation model

**Embedding model**:
The model that turns text into vectors for retrieval. It is always a different model from the language model, even when both come from the same provider.
_Avoid_: embeddings model

### Retrieval

**Embedder**:
Retrieval's source of vectors: either an embedding model, or the mock embedder, a deterministic lexical stand-in that needs no AI provider.
_Avoid_: embedding provider
