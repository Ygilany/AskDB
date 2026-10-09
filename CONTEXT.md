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
Retrieval's source of vectors: anything that turns a batch of texts into vectors. It is usually backed by an embedding model. AskDB also ships the mock embedder, a deterministic lexical stand-in that needs no AI provider, and a host can supply its own.
_Avoid_: embedding provider

### Introspection

**Engine package**:
The package for one database engine (`@askdb/postgres`, `@askdb/mysql`, `@askdb/sqlite`, `@askdb/sqlserver`, `@askdb/prisma`): its catalog SQL, its optional driver peer, its connection-string formats, and its connector provider adapter (ADR 0008).
_Avoid_: integration, dialect package

**Connector provider adapter**:
What an engine package exports so a host can pick it by provider id: it builds the engine's connector, resolves its connection from explicit values and AskDB config (`resolveConnection`), and parses a connection into display-safe parts (`connectionLabelParts`).
_Avoid_: provider, driver

**Connector registry**:
The set of connector provider adapters a host registered, keyed by provider id (`createConnectorRegistry` in `@askdb/introspect`). Provider ids are open strings, so a third-party engine registers its own.

**Connection label**:
A display-safe description of a connection, such as `postgres://db:5432/app`, built only from the parts the engine's parser extracts; a connection that doesn't parse cleanly is `configured <engine> connection` (ADR 0011). The registry returns it as `sourceLabel`.
_Avoid_: redacted URL, masked connection string

**Engine kit**:
`@askdb/introspect/kit`, the engine-agnostic helpers every engine package is built on: optional-driver loading, table filters, ids, row folding and connection labels.
