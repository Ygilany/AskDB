import pg from "pg";
import { describe, expect, it } from "vitest";
import { createConnectorRegistry } from "@askdb/introspect";
import { postgresConnectorProvider } from "./connector/provider.js";
import { parsePostgresConnection } from "./label.js";

// The label hosts see: the adapter's parsed parts, built by the registry.
const registry = createConnectorRegistry([postgresConnectorProvider]);
const connectionLabel = (url: string) => registry.connectionLabel("postgres", { url });

const FALLBACK = "configured postgres connection";

// Inputs that leaked a secret through the earlier masking redactor (review
// rounds 1-3 on #189/#195/#199) sit next to ordinary strings. The parts come
// from pg-connection-string, the parser `pg` uses (ADR 0011).
const CORPUS: ReadonlyArray<readonly [input: string, label: string]> = [
  // Ordinary strings.
  ["postgres://app:S3cret@db.example.com:5432/app?sslmode=verify-full", "postgres://db.example.com:5432/app"],
  ["postgresql://localhost/app", "postgres://localhost/app"],
  ["postgres://db/app?user=app&password=S3cret&sslpassword=k", "postgres://db/app"],
  ["postgres://app:p%40ss@[::1]:5432/app", "postgres://[::1]:5432/app"],
  ["postgres://app:p@ss@db/app", "postgres://db/app"],
  ["postgres:///app", "postgres:///app"],
  // A `?host=` override is the host the driver connects to (delta review 3).
  ["postgres://app:S3cret@db/app?host=replica", "postgres://replica/app"],
  // Round 1: a password with an unencoded / or # was echoed unchanged.
  ["postgres://app:pa/ss@db:5432/app", FALLBACK],
  ["postgres://app:pa#ss@db:5432/app", FALLBACK],
  ["postgres://app:p@ss/w#rd@db:5432/app", FALLBACK],
  // Round 2: leading whitespace hid the URL from the redactor.
  [" postgres://app:S3cret@db:5432/app", FALLBACK],
  // Round 3: a quoted value with trailing text leaked the tail (`****cd`).
  ["postgres://db:5432/app?password='ab'cd", "postgres://db:5432/app"],
  ["postgres://db:5432/app?sslmode=verify-full&password=\"ab\"cd", "postgres://db:5432/app"],
  // Round 3: JDBC and near-miss URL forms came back unchanged.
  ["jdbc:postgresql://u:secret@h/db", FALLBACK],
  ['"postgres://u:secret@h/db"', FALLBACK],
  ["'postgres://u:secret@h/db'", FALLBACK],
  ["postgres:/u:secret@h/db", FALLBACK],
  // A password cut short by ? or / would otherwise land in the host, port or path.
  ["postgres://u:12?x@db/app", FALLBACK],
  ["postgres://u:5432/secret@db/app", FALLBACK],
  // libpq keyword/value strings: pg-connection-string reads them as a socket path.
  ["host=db user=app password=S3cret dbname=app", FALLBACK],
  ["host=db password='se cr\\'et' dbname=app", FALLBACK],
  // Multi-host and socket-directory hosts are not a single network host.
  ["postgres://u:pw@h1:5432,h2:5432/app", FALLBACK],
  ["postgres://%2Fvar%2Frun%2Fpostgresql/app", FALLBACK],
];

describe("postgres connection label (postgresConnectorProvider.connectionLabelParts through the registry)", () => {
  it.each(CORPUS)("%s -> %s", (input, label) => {
    expect(connectionLabel(input)).toBe(label);
  });
});

// Differential: whenever the label shows a part, it is the one `pg` itself
// resolves from the same string. Rows that fall back show nothing to compare.
describe("postgres label parts match what pg resolves", () => {
  const shown = CORPUS.map(([input]) => input).filter((input) => {
    const parts = parsePostgresConnection(input);
    return parts !== undefined && !("file" in parts) && connectionLabel(input) !== FALLBACK;
  });

  it.each(shown)("%s", (input) => {
    const parts = parsePostgresConnection(input) as { host?: string; port?: string; database?: string };
    const client = new pg.Client({ connectionString: input });
    // An IPv6 host is shown bracketed (`[::1]`); pg holds it bare.
    if (parts.host !== undefined) expect(parts.host.replace(/^\[(.*)\]$/, "$1")).toBe(client.host);
    if (parts.port !== undefined) expect(Number(parts.port)).toBe(client.port);
    if (parts.database !== undefined) expect(parts.database).toBe(client.database);
  });
});

// pg-connection-string's parse() reads the files ssl* params name; a label
// never needs them, so they are removed before parsing (delta review 4).
describe("postgres label ignores ssl* parameters", () => {
  it.each([
    "postgres://u:pw@db:5432/app?sslrootcert=/nonexistent/ca.pem",
    "postgres://u:pw@db:5432/app?sslmode=verify-full&sslcert=/nonexistent/client.crt&sslkey=/nonexistent/client.key",
    "postgres://u:pw@db:5432/app?%73slrootcert=/nonexistent/ca.pem",
  ])("%s -> postgres://db:5432/app, without reading the files", (input) => {
    expect(connectionLabel(input)).toBe("postgres://db:5432/app");
  });
});

describe("postgres export-bundle label", () => {
  it.each([
    ["./exports/pagila", "./exports/pagila"],
    ["./exports?password=S3cret", FALLBACK],
  ])("%s -> %s", (fromExport, label) => {
    expect(registry.connectionLabel("postgres", { fromExport })).toBe(label);
  });

  it("names the export when a URL is also set, as createConnector reads the export", () => {
    expect(registry.connectionLabel("postgres", { url: "postgres://db/app", fromExport: "./exports/pagila" })).toBe(
      "./exports/pagila",
    );
  });
});
