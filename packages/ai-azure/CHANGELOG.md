# @askdb/ai-azure

## 0.1.0-beta.2

### Patch Changes

- baf5ad8: Restore AI SDK 6 embedding compatibility and preserve RAG embedding options.
- baf5ad8: Refresh dependency ranges across the workspace.
- Updated dependencies [baf5ad8]
- Updated dependencies [baf5ad8]
  - @askdb/ai@0.1.0-beta.2

## 0.1.0-beta.1

### Minor Changes

- bc8642f: Move AskDB AI provider construction helpers from `@askdb/core` into the new `@askdb/ai` registry and provider adapter packages.

  `@askdb/core` now exposes `AskDbLanguageModel` as its public model type and no longer installs concrete AI SDK provider packages. Consumers that used `createAskDbLanguageModelFromEnv`, embedding model factories, or AI config resolution from core should create an `@askdb/ai` registry with provider adapters such as `@askdb/ai-openai`.

### Patch Changes

- Updated dependencies [bc8642f]
  - @askdb/ai@0.1.0-beta.1
