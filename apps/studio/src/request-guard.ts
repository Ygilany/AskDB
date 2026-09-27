import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { networkInterfaces } from "node:os";

/**
 * Request guard for the Studio local server.
 *
 * Studio's API can execute SQL against the configured database and write
 * schema files, so it must not be drivable by arbitrary web pages the
 * developer happens to visit. Three layers, applied before routing:
 *
 * 1. Host allowlist (every request, including static assets) — defeats DNS
 *    rebinding: a page on `evil.example` that rebinds to 127.0.0.1 still sends
 *    `Host: evil.example:<port>`.
 * 2. Origin + content-type checks on state-changing `/api/*` requests —
 *    cross-site `fetch`/form posts carry a foreign `Origin`, and requiring
 *    `application/json` forces a CORS preflight that Studio never answers.
 * 3. A per-launch random session token, embedded in the served `index.html`
 *    and required on every `/api/*` request as `x-askdb-studio-token`. A
 *    cross-origin page can't read `index.html`, so it can't learn the token.
 */

export const STUDIO_TOKEN_HEADER = "x-askdb-studio-token";
export const STUDIO_TOKEN_META_NAME = "askdb-studio-token";

export type GuardFailure = { status: 403 | 415; message: string };

export function createStudioSessionToken(): string {
  return randomBytes(32).toString("hex");
}

/** Hosts that mean "listen on every interface". */
export function isWildcardHost(host: string | undefined): boolean {
  if (host === undefined) return false;
  const h = host.trim().toLowerCase();
  return h === "" || h === "0.0.0.0" || h === "::" || h === "[::]";
}

/** True for hosts only reachable from this machine. */
export function isLoopbackHost(host: string | undefined): boolean {
  if (host === undefined) return true;
  const h = host.trim().toLowerCase();
  return (
    h === "localhost" ||
    h === "::1" ||
    h === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(h)
  );
}

// A Host header is `hostname[:port]` — nothing else. Rejecting userinfo, paths,
// and whitespace up front matters because `new URL("http://" + host)` would
// happily parse `evil@127.0.0.1` as hostname 127.0.0.1.
const HOST_HEADER_PATTERN = /^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;

/** Parse a Host header into its normalized `hostname` / `host` / numeric port. */
function parseHostHeader(value: string): { hostname: string; host: string; port: number } | null {
  if (!HOST_HEADER_PATTERN.test(value)) return null;
  try {
    const url = new URL(`http://${value}`);
    return { hostname: url.hostname, host: url.host, port: url.port === "" ? 80 : Number(url.port) };
  } catch {
    return null;
  }
}

/** Normalize a bare host/IP the same way `URL` normalizes a Host header's hostname. */
function normalizeHostname(host: string): string | null {
  const trimmed = host.trim();
  if (trimmed === "") return null;
  const bracketed = trimmed.includes(":") && !trimmed.startsWith("[") ? `[${trimmed}]` : trimmed;
  try {
    return new URL(`http://${bracketed}`).hostname;
  } catch {
    return null;
  }
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isAllowedHostname(hostname: string, listenHost: string | undefined): boolean {
  if (LOOPBACK_HOSTNAMES.has(hostname)) return true;
  if (listenHost === undefined) return false;
  if (isWildcardHost(listenHost)) {
    // Bound to every interface: accept this machine's own interface addresses
    // (e.g. the LAN IP the CLI prints). IP literals can't be DNS-rebound.
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (normalizeHostname(entry.address) === hostname) return true;
      }
    }
    return false;
  }
  return normalizeHostname(listenHost) === hostname;
}

/**
 * Host allowlist. Accepts `localhost`, `127.0.0.1`, `[::1]`, and the explicitly
 * configured listen host (or, for wildcard binds, this machine's interface
 * addresses) — and only on the port the connection actually arrived on.
 */
export function checkHost(req: IncomingMessage, listenHost: string | undefined): GuardFailure | null {
  const raw = req.headers.host;
  const parsed = typeof raw === "string" ? parseHostHeader(raw) : null;
  if (
    !parsed ||
    parsed.port !== req.socket.localPort ||
    !isAllowedHostname(parsed.hostname, listenHost)
  ) {
    return {
      status: 403,
      message:
        "Studio rejected this request: unrecognized Host header. Open Studio via http://127.0.0.1:<port> or http://localhost:<port>.",
    };
  }
  return null;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * `/api/*` checks: same-origin `Origin` on state-changing requests, the
 * per-launch session token, and a JSON content type on requests with a body.
 * Call after {@link checkHost} has passed.
 */
export function checkApiRequest(req: IncomingMessage, sessionToken: string): GuardFailure | null {
  const method = (req.method ?? "GET").toUpperCase();

  if (!SAFE_METHODS.has(method)) {
    const origin = req.headers.origin;
    if (origin !== undefined && !isSameOrigin(origin, req.headers.host)) {
      return { status: 403, message: "Studio rejected this request: cross-origin requests are not allowed." };
    }
  }

  if (!tokenMatches(req.headers[STUDIO_TOKEN_HEADER], sessionToken)) {
    return {
      status: 403,
      message:
        "Studio rejected this request: missing or invalid session token. Reload Studio in the browser (the token changes every launch).",
    };
  }

  if (!SAFE_METHODS.has(method) && (method !== "DELETE" || hasRequestBody(req))) {
    const contentType = req.headers["content-type"];
    const mediaType = typeof contentType === "string" ? contentType.split(";")[0]!.trim().toLowerCase() : "";
    if (mediaType !== "application/json") {
      return { status: 415, message: "Studio API requests must use Content-Type: application/json." };
    }
  }

  return null;
}

function isSameOrigin(origin: string | string[], hostHeader: string | undefined): boolean {
  if (typeof origin !== "string" || typeof hostHeader !== "string") return false;
  const host = parseHostHeader(hostHeader);
  if (!host) return false;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && url.host === host.host;
  } catch {
    // Includes `Origin: null` (sandboxed iframes, file://, some redirects).
    return false;
  }
}

function tokenMatches(provided: string | string[] | undefined, expected: string): boolean {
  if (typeof provided !== "string") return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function hasRequestBody(req: IncomingMessage): boolean {
  const length = req.headers["content-length"];
  if (length !== undefined && Number(length) > 0) return true;
  return req.headers["transfer-encoding"] !== undefined;
}

/** Insert the session-token `<meta>` tag into the served `index.html`. */
export function injectSessionToken(html: string, sessionToken: string): string {
  const tag = `<meta name="${STUDIO_TOKEN_META_NAME}" content="${sessionToken}" />`;
  return html.includes("</head>") ? html.replace("</head>", `    ${tag}\n  </head>`) : `${tag}\n${html}`;
}
