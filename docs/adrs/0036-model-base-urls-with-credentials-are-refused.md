# ADR 0036 — A model base URL with a user name or password is refused, never masked

## Status

Accepted (2026-11-06, the coordinating thread's answer on #787, option A, and Round 1, Q1 A). Implemented in PR #790. It amends ADR 0005's rule that only `@askdb/config` reads `process.env`, for one narrow case.

> **Amendment (2026-11, #711 candidate 7, #765):** Two of the paths below changed. `rag.embedderConfig` is removed, so a config that sets it fails to load as a removed key, and that error names the key, never its value. And `@askdb/config` no longer maps a connection into an env map: a host passes the typed section to `@askdb/ai`'s `*FromSection` methods, which refuse a credentialed `connection.baseUrl` with `AiBaseUrlCredentialsError` (`setting: "connection.baseUrl"`), whether or not the connection has a key. A model they build still goes through `baseURLOption()`, so the SDK fallback check holds on that path too. The config-load check is unchanged.

## Context

A model base URL such as `http://user:pass@proxy.example/v1` never worked: `fetch` refuses a URL with userinfo, with the error `Request cannot be constructed from a URL that includes credentials: <the whole URL>`. `@askdb/core` copied that message into `SqlGenerationError` and the `askdb.pipeline.failed` log, so the credentials reached stderr and every log sink (#787).

A model base URL reaches the provider SDK in four ways:

- **The config file:** `ai.providerConfig.<provider>.baseUrl`, and the deprecated `rag.embedderConfig.openai.baseUrl`, which `@askdb/config` maps into `aiEnv`.
- **An env map:** `ASKDB_AI_BASE_URL` and each provider's base URL variables, which `@askdb/ai`'s `resolveBaseConfig` reads from the map a host passes.
- **An `AiConfig`:** a host passes one straight to a built-in provider's `createLanguageModel` or `createEmbeddingModel`.
- **The SDK's own fallback:** with no `baseURL`, `@ai-sdk/openai` reads `OPENAI_BASE_URL` and `@ai-sdk/anthropic` reads `ANTHROPIC_BASE_URL` from `process.env` themselves. `@ai-sdk/google`, `@ai-sdk/azure` (whose `AZURE_RESOURCE_NAME` is checked as a DNS label) and the gateway don't.

## Options considered

- **A. Refuse it where AskDB reads it, with an error that names the setting (chosen).** The error never repeats the URL. Such a URL never worked, so refusing it costs a working setup nothing.
- **B. Mask the credentials out of the failure's text in core.** Rejected for the reason ADR 0011 gives for connection labels: masking copies everything it doesn't recognise as a secret, so an unrecognised spelling leaks. It would also keep sending a URL that can't work.
- **C. A config field for request headers, so a proxy's credentials have a supported home.** Not chosen now: no built-in provider connection takes headers today, and a host that needs them builds the model in code with the AI SDK provider's `headers` option. It can be added later without undoing A.

## Decision

- **A URL counts** when `new URL()` reports a `username` or `password`, or when it doesn't parse and holds an `@`. An `@` in the path doesn't count.
- **Config load (`@askdb/config`)** refuses one in any `ai.providerConfig.<provider>.baseUrl`, used by a section or not, and in `rag.embedderConfig.openai.baseUrl`. It throws a plain `askdb.config:` error like its neighbors, naming the key, and the loader adds the file name. If AskDB later types its config errors, this one moves with the rest (#711 candidate 7).
- **`@askdb/ai`** throws `AiBaseUrlCredentialsError`, whose `setting` names the source:
  - the env variable, from `resolveBaseConfig`;
  - `baseURL`, from a built-in provider building a model from an `AiConfig`, through `baseURLOption()`;
  - the SDK's own variable (`OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`), when the `AiConfig` gives no `baseURL`.
- **No message repeats the URL** or any part of it. Each says to put the key in the provider's API key setting, or to send other credentials as headers on a model built in code.
- **The ADR 0005 exception:** to check the SDK's own fallback, `@askdb/ai` reads that one variable from `process.env`, and only when the `AiConfig` has no `baseURL`. It never uses the value; the SDK still reads it. This is the only `process.env` read outside `@askdb/config`.

## Consequences

- A config with a credentialed `baseUrl` on a connection nothing uses also fails to load. The `@askdb/config` changeset is a minor, and the beta.50 upgrade entry says so.
- `@askdb/config` and `@askdb/ai` each hold a copy of the rule, because neither depends on the other. Their tests feed both the same URLs (with a password, a user name only, unparseable with an `@`, an `@` in the path).
- A built-in provider added later runs through `baseURLOption()`: the `@askdb/ai` test iterates `BUILTIN_AI_PROVIDERS`, and the new-ai-adapter skill's template calls it. A provider whose SDK reads its own base URL variable passes that name.
- `@askdb/rag`'s deprecated `createOpenAiEmbedder({ baseURL })` isn't covered: `@askdb/rag` doesn't depend on `@askdb/ai`, and the helper leaves at 1.0.

## Related

- ADR 0005 (config and env bootstrap), amended here.
- ADR 0011 (connection labels from parsed parts), whose reasoning rejects option B.
- #787, PR #790.
