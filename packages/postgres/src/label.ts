import type { ConnectionLabelParts } from "@askdb/connectors";
import { parse } from "pg-connection-string";

/**
 * The display-safe parts of a Postgres connection string, read by
 * `pg-connection-string` — the parser `pg` itself uses — so the label names the
 * host, port and database the driver will actually use (a `?host=` override
 * included). Never a reimplementation of the URL grammar (ADR 0011).
 *
 * Returns `undefined` (the registry labels it `configured postgres connection`)
 * when the parser throws, when the input isn't a `postgres://` /
 * `postgresql://` URL (the parser reads anything else as a socket path), or
 * when an `@` or `#` sits after the host: a password containing `/`, `?` or `#`
 * is split there, and the "host" or "database" the parser finds is then part
 * of the password. `formatConnectionLabel`'s allowlist is the second check.
 */
export function parsePostgresConnection(input: string): ConnectionLabelParts | undefined {
  let url: URL;
  let parsed: ReturnType<typeof parse>;
  try {
    url = new URL(input);
    parsed = parse(withoutSslParams(input));
  } catch {
    return undefined;
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return undefined;
  if (url.hash !== "" || `${url.pathname}${url.search}`.includes("@")) return undefined;
  const { host, port, database } = parsed;
  return {
    ...(typeof host === "string" && host !== "" ? { host } : {}),
    ...(typeof port === "string" && port !== "" ? { port } : {}),
    ...(typeof database === "string" && database !== "" ? { database } : {}),
  };
}

/**
 * The query without its `ssl*` parameters. `parse()` reads the files named by
 * `sslcert`, `sslkey` and `sslrootcert` and warns process-wide for some
 * `sslmode` values; none of them can change the host, port or database, so a
 * label never needs them. Removed textually, so the rest of the string reaches
 * the parser exactly as written.
 */
function withoutSslParams(input: string): string {
  const query = input.indexOf("?");
  if (query === -1) return input;
  const kept = input
    .slice(query + 1)
    .split("&")
    .filter((param) => !isSslKey(param.split("=", 1)[0]!));
  return kept.length > 0 ? `${input.slice(0, query)}?${kept.join("&")}` : input.slice(0, query);
}

/** Decoded as the parser's URLSearchParams would (`%73slkey` is `sslkey`); undecodable keys are dropped too. */
function isSslKey(rawKey: string): boolean {
  try {
    return /^ssl/i.test(decodeURIComponent(rawKey.replace(/\+/g, " ")));
  } catch {
    return true;
  }
}
