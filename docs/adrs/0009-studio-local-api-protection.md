# ADR 0009 — Protecting Studio's local API: in-page session token, not a Jupyter-style login token

## Status

Accepted (2026-09-25). Implemented by PR #185 (`apps/studio/src/request-guard.ts`).

## Context

Studio (`askdb studio` / `askdb-studio`) is a local server plus a browser app. Its API does more
than read metadata:

- it runs SQL against the configured database (`/api/execute`, opt-in since PR #194),
- it writes the schema artifact (`/api/tables/*`, `/api/concepts`, `/api/tenant-policy`), which
  production `ask()` later reads as prompt content,
- it writes `askdb.config.ts` from the setup wizard, and that file is then executed via jiti,
- it spends the developer's LLM key (`/api/ask`, `/api/suggest`, `/api/rag/index`).

Before PR #185 it checked nothing but the socket address, and only on a few routes. The security
review found two practical attacks from any web page open in the developer's browser:

1. **Cross-site requests (CSRF).** A `fetch("http://127.0.0.1:5556/api/execute", { mode: "no-cors",
   headers: { "content-type": "text/plain" }, body: … })` needs no CORS preflight. The request
   arrives from 127.0.0.1, so the socket-address check passed.
2. **DNS rebinding.** `evil.example` resolves to 127.0.0.1 after the page loads. The browser then
   treats Studio as same-origin with the attacker, who can read responses as well as send requests.

Chained with the setup wizard's unescaped config writer (also fixed in #185), either one led to
code execution on the developer's machine.

The threat model this ADR targets: **one developer, on their own machine, Studio bound to
loopback (the default: `127.0.0.1:5556`), with arbitrary untrusted websites open in the same
browser.** Studio prints its URL at startup and does not open a browser itself.

## Decision

Apply one request guard before every route (`checkHost` on every request, `checkApiRequest` on
`/api/*`):

1. **Host allowlist on every request, including `/` and `/assets/*`.** The hostname must be
   `localhost`, `127.0.0.1` or `[::1]`, or the configured listen host. For wildcard binds, this
   machine's own interface addresses are also accepted. The port must equal the port the
   connection arrived on; anything else gets `403`. This defeats DNS rebinding, because a rebound
   request still carries `Host: evil.example:<port>`. Checking the page itself is what stops an
   attacker from reading the token.
2. **Same-origin `Origin` check** on state-changing `/api/*` requests, and
   **`Content-Type: application/json`** on requests with a body (`415` otherwise). The JSON
   requirement forces a CORS preflight, which Studio never answers.
3. **A per-launch session token** from `crypto.randomBytes(32)` (256 bits, hex). It is injected
   into the served `index.html` as `<meta name="askdb-studio-token">` and required on every
   `/api/*` request as the `x-askdb-studio-token` header, compared in constant time. The browser
   app reads it through the single fetch helper in `src/web/api.ts`. Embedders can read it from
   `StudioServer.sessionToken`.
4. **Page hardening.** `index.html` is sent with `Cache-Control: no-store`,
   `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`. That stops
   clickjacking and keeps a stale token out of browser caches.
5. **Defense in depth.** Loopback bind by default. A startup warning when bound elsewhere.
   Setup, resync and driver install stay restricted to loopback clients.

This is the **synchronizer-token pattern** (the same idea as Rails' and Django's CSRF tokens). The
token proves that a request came from Studio's own page. It does **not** prove who the user is.
Its secrecy rests on the browser's same-origin policy plus the Host check: another site can send
requests to Studio but can never read `index.html`, so it can never learn the token.

## Alternatives considered

### A. Jupyter-style login token (the main alternative)

Jupyter prints a one-time token in the terminal as part of the launch URL
(`http://127.0.0.1:8888/?token=…`). The page will not load without it. On first visit the token is
exchanged for an `HttpOnly; SameSite=Strict` cookie, and the browser is redirected to drop the
token from the URL.

- **Stronger:** it authenticates the *user*, not just the page. Other OS users on a shared machine,
  other local processes, and anyone on the LAN (when bound to `0.0.0.0`) can't use Studio unless
  they can see the terminal. An `HttpOnly` cookie also can't be read by page scripts.
- **Why not now:**
  - *Target environment.* The default is one developer, loopback, a personal machine. There, the
    extra protection defends against local users and processes that could already read the
    developer's files, `.env` and `askdb.config.ts`, which hold the same database and LLM
    credentials Studio uses.
  - *UX cost.* A plain `http://127.0.0.1:5556` bookmark or a typed URL stops working. Every
    restart forces a fresh copy-paste from the terminal. Tooling that opens the printed URL needs
    the token threaded through.
  - *Token-in-URL leaks.* The first URL lands in shell scrollback, screen shares, logs and
    browser history. That is manageable, but it is a new leak class to handle.
  - *Complexity.* A cookie session, the exchange-and-redirect flow and a logout/rotation story
    are all more code in a dev tool.

### B. `SameSite=Strict` cookie only, no token

The server would set the cookie on first load and require it on `/api/*`. On its own this is
weaker than the chosen design. `SameSite` does not apply across ports on the same host (site ≠
origin). A request from another local web app on `localhost:<other-port>` counts as same-site, and
a rebound origin would still receive the cookie if the Host check were ever missing.

### C. Loopback bind plus the socket-address check only (the status quo before #185)

Rejected. Browser requests from the developer's own machine come from 127.0.0.1, so this stops
neither CSRF nor DNS rebinding.

### D. Password or OS-level authentication (a Unix domain socket, a per-user password)

Rejected as out of proportion for a local authoring tool. Browsers also can't reach a Unix
socket, so it would need a helper.

## Consequences

**Protected:** cross-site requests from any website, DNS rebinding, clickjacking, and stale tokens
in caches. The setup-wizard code-injection chain is closed separately, by escaping values with
`JSON.stringify` in `setup.ts` and `init.ts`.

**Not protected — accepted limits of this decision:**

- **Anyone who can load the page gets the token.** That includes:
  - other machines on the network when Studio is bound to a non-loopback address (the startup
    warning says so);
  - other OS users or processes on the same machine that can reach the loopback port;
  - a malicious browser extension with access to the page, or an XSS bug in Studio. Studio's web
    UI renders no raw HTML today, which keeps that class small.
- **Browser tabs from a previous launch** get `403` until reloaded, because the token changes
  every launch.
- **Reverse proxies and forwarded ports** that rewrite `Host` are rejected. Examples: devcontainer
  or Codespaces port forwarding, or an nginx proxy. There is no allowed-hosts option yet.
- **Scripts calling Studio's API** must send the token (`StudioServer.sessionToken`), so the
  `@askdb/studio` changeset is a minor bump.

## When to revisit (triggers)

Move to the Jupyter-style design (Alternative A) when any of these becomes a supported use case or
a real report:

- Studio running on **shared or multi-user machines** (shared dev boxes, lab servers).
- Studio **bound to a network interface** for teammates, or offered as a hosted or team service.
- Studio used through **remote or forwarded environments** (Codespaces, devcontainers, SSH port
  forwarding, a reverse proxy). This also needs an explicit `allowedHosts` setting.
- A **security report** that a local process or LAN client drove Studio.
- Studio gaining capabilities beyond the developer's own file access, such as credentials that
  aren't also in the developer's local files.

## Migration path, if revisited

The two designs share the same guard seam, so the change stays inside `request-guard.ts`,
`server.ts` and `web/api.ts`:

1. At launch, print `http://127.0.0.1:<port>/?token=<t>`, and keep `StudioServer.sessionToken` for
   embedders.
2. When `GET /` arrives with a valid `?token=`, set `Set-Cookie: askdb_studio=<t>; HttpOnly;
   SameSite=Strict; Path=/`, then `302` to `/` so the token leaves the URL. Otherwise serve a small
   "open the URL printed in your terminal" page, without the app and without the token.
3. On `/api/*`, accept the cookie. Keep the `Origin`, JSON content-type and Host checks. A
   separate anti-CSRF header is still worth keeping, because `SameSite` does not isolate different
   ports on `localhost` (see Alternative B).
4. Add `studio.listen.allowedHosts` for proxied or forwarded setups.
5. Document the change in the Studio page's Security model section and in
   `docs/specs/studio.md`, and ship it as a minor changeset.

## Related

- PR #185 — the implementation. PR #194 makes execute opt-in, single-statement, read-only, with
  timeouts and row caps.
- `docs/specs/studio.md` § Security model, and the docs-site Studio page § Security model.
- `SECURITY.md` — scope for reports about Studio.
