# @askdb/enrich

## 0.2.0-beta.10

### Patch Changes

- Updated dependencies [7311ac5]
  - @askdb/core@1.0.0-beta.36

## 0.2.0-beta.9

### Patch Changes

- Updated dependencies [baf5ad8]
  - @askdb/core@1.0.0-beta.26

## 0.2.0-beta.8

### Patch Changes

- Updated dependencies [dda0abf]
  - @askdb/core@1.0.0-beta.21

## 0.2.0-beta.7

### Patch Changes

- Updated dependencies [bc8642f]
  - @askdb/core@1.0.0-beta.20

## 0.2.0-beta.6

### Minor Changes

- 70a655c: Add untracked tables feature: tables marked as untracked are excluded from LLM prompts and RAG indexing while remaining visible in the schema and studio. Tracking status persists in the describable layer (tables/\*.md) and survives re-introspection. Studio UI adds a toggle in the Sensitivity tab and a visual indicator with filter in the table list.

### Patch Changes

- Updated dependencies [70a655c]
  - @askdb/core@0.5.0-beta.18

## 0.2.0-beta.5

### Patch Changes

- Updated dependencies [36c35b4]
  - @askdb/core@0.5.0-beta.16

## 0.2.0-beta.4

### Patch Changes

- Updated dependencies [c3c0f21]
  - @askdb/core@0.5.0-beta.14

## 0.2.0-beta.3

### Patch Changes

- Updated dependencies [02edcc5]
  - @askdb/core@0.5.0-beta.12

## 0.2.0-beta.2

### Patch Changes

- Updated dependencies [1f46cd1]
  - @askdb/core@0.5.0-beta.10

## 0.2.0-beta.1

### Patch Changes

- Updated dependencies [eb325a2]
- Updated dependencies [a4f14f7]
  - @askdb/core@0.5.0-beta.4

## 0.2.0-beta.0

### Minor Changes

- 373e152: Add `@askdb/enrich` as the shared Schema v2 enrichment workspace package.

  Studio and TUI now both depend on `@askdb/enrich` for workspace loading,
  draft construction, markdown section updates, persistence helpers, and AI
  suggestion target/context builders. Studio no longer depends on `@askdb/tui`.

### Patch Changes

- Updated dependencies [5e20605]
- Updated dependencies [b0d84d7]
- Updated dependencies [25980e4]
- Updated dependencies [289e63e]
- Updated dependencies [a90543b]
- Updated dependencies [fdfd059]
- Updated dependencies [b018d88]
- Updated dependencies [4e462eb]
- Updated dependencies [b24af19]
- Updated dependencies [cd23f50]
  - @askdb/core@0.5.0-beta.0
