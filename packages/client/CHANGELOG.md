# @askdb/client

## 1.0.0-beta.3

### Minor Changes

- 7311ac5: **@askdb/client**: `createAskDb()` accepts a new `providers` option — pass the adapter(s) for your configured provider and the client builds the AI registry internally:

  ```ts
  import { createAskDb } from "@askdb/client";
  import { openaiProvider } from "@askdb/ai-openai";

  const askdb = createAskDb({
    config: getAskDbRuntimeConfig(),
    providers: [openaiProvider], // no more createAiRegistry boilerplate
  });
  ```

  You no longer import anything from `@askdb/ai` on the config-driven path — it is now a regular dependency of `@askdb/client` (previously a peer), so install commands drop it too. The existing `registry` option remains supported as the advanced alternative (e.g. sharing one registry across several clients); passing both, or neither, throws with a clear message. Non-breaking for existing `registry` callers.

  **@askdb/studio**: the Playground "Get the code" panel emits the new `providers` style in its config-driven snippet.

### Patch Changes

- 162c33b: Docs only: package READMEs now lead with the `createAskDb({ providers: [...] })` path — no direct `@askdb/ai` import — with the standalone `createAiRegistry` usage kept as the documented advanced alternative.
- Updated dependencies [162c33b]
- Updated dependencies [7311ac5]
  - @askdb/ai@0.1.0-beta.4
  - @askdb/core@1.0.0-beta.36

## 1.0.0-beta.2

### Patch Changes

- Updated dependencies [dc380bc]
  - @askdb/config@1.0.0-beta.9

## 0.1.0-beta.1

### Minor Changes

- 354c833: Add `@askdb/client`: a config-aware `createAskDb()` facade that resolves schema, model, and dialect from the runtime config so callers only pass a question. `schema`, `model`, and `dialect` remain optional per-call overrides. `ask()` in `@askdb/core` is unchanged and remains the pure, BYO-model primitive.
- 354c833: `@askdb/client` now throws typed errors and supports `unknownDialect: "throw" | "fallback-postgres"`. The HTTP API uses those error types to return 400 `schema_parse_error` for missing schema files and to preserve the postgres fallback for unrecognized schema providers.
