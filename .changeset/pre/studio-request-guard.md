---
"@askdb/studio": minor
"askdb": patch
---

**@askdb/studio** (security): The local API now rejects requests from other websites in your browser, closing a cross-site request and DNS-rebinding hole that let any open web page run SQL through `/api/execute` or rewrite schema files.

- Every request must send an allowed `Host`: `localhost`, `127.0.0.1`, `[::1]`, or the bound host (for `0.0.0.0` binds, this machine's own IP addresses), on Studio's own port.
- Every `/api/*` call must send the per-launch session token that Studio injects into the page it serves, as the `x-askdb-studio-token` header.
- State-changing calls must be same-origin, and requests with a body must use `Content-Type: application/json`.

The web app now shows the HTTP status instead of a JSON parse error when a failed API request returns a non-JSON body (a proxy error page or an empty 502); server-provided error messages are still shown as before. Binding to a non-loopback host now prints a startup warning. `createStudioServer()` returns the token as `server.sessionToken` for programmatic callers. This is a breaking change for any client that called the API without it. The setup wizard's `askdb.config.ts` writer now emits every value with `JSON.stringify`, rejects control characters in paths, and validates the execute provider. Previously, a crafted path could inject code that ran when Studio loaded the config.

**askdb**: `askdb init` escapes every value it writes into `askdb.config.ts` the same way, so quotes or backslashes in `--schema-out`, `--sqlite-file`, `--prisma-schema`, or env-name flags can no longer break out of their string literals.
