import { describe, expect, it } from "vitest";
import { createConnectorRegistry } from "@askdb/connectors";
import { postgresConnectorProvider } from "./connector/provider.js";

// The label hosts see: the adapter's parsed parts, built by the registry.
const registry = createConnectorRegistry([postgresConnectorProvider]);
const connectionLabel = (url: string) => registry.connectionLabel("postgres", { url });

const FALLBACK = "configured postgres connection";

// Inputs that leaked a secret through the earlier masking redactor (review
// rounds 1-3 on #189/#195/#199) sit next to ordinary strings. A label only ever
// holds host, port and database parsed from a clean URL.
describe("postgres connection label (postgresConnectorProvider.connectionLabelParts through the registry)", () => {
  it.each([
    // Ordinary strings.
    ["postgres://app:S3cret@db.example.com:5432/app?sslmode=require", "postgres://db.example.com:5432/app"],
    ["postgresql://localhost/app", "postgres://localhost/app"],
    ["postgres://db/app?user=app&password=S3cret&sslpassword=k", "postgres://db/app"],
    ["postgres://app:p%40ss@[::1]:5432/app", "postgres://[::1]:5432/app"],
    ["postgres://app:p@ss@db/app", "postgres://db/app"],
    ["postgres:///app", "postgres:///app"],
    // Round 1: a password with an unencoded / or # was echoed unchanged.
    ["postgres://app:pa/ss@db:5432/app", FALLBACK],
    ["postgres://app:pa#ss@db:5432/app", FALLBACK],
    ["postgres://app:p@ss/w#rd@db:5432/app", FALLBACK],
    // Round 2: leading whitespace hid the URL from the redactor.
    [" postgres://app:S3cret@db:5432/app", FALLBACK],
    // Round 3: a quoted value with trailing text leaked the tail (`****cd`).
    ["postgres://db:5432/app?password='ab'cd", "postgres://db:5432/app"],
    ["postgres://db:5432/app?sslmode=require&password=\"ab\"cd", "postgres://db:5432/app"],
    // Round 3: JDBC and near-miss URL forms came back unchanged.
    ["jdbc:postgresql://u:secret@h/db", FALLBACK],
    ['"postgres://u:secret@h/db"', FALLBACK],
    ["'postgres://u:secret@h/db'", FALLBACK],
    ["postgres:/u:secret@h/db", FALLBACK],
    // A password cut short by ? or / could otherwise land in the port or path.
    ["postgres://u:12?x@db/app", FALLBACK],
    ["postgres://u:5432/secret@db/app", FALLBACK],
    // libpq keyword/value strings are not parsed into a label.
    ["host=db user=app password=S3cret dbname=app", FALLBACK],
    ["host=db password='se cr\\'et' dbname=app", FALLBACK],
    // Multi-host and percent-encoded socket hosts are not a single clean host.
    ["postgres://u:pw@h1:5432,h2:5432/app", FALLBACK],
    ["postgres://%2Fvar%2Frun%2Fpostgresql/app", FALLBACK],
  ])("%s -> %s", (input, label) => {
    expect(connectionLabel(input)).toBe(label);
  });
});

describe("postgres export-bundle label", () => {
  it.each([
    ["./exports/pagila", "./exports/pagila"],
    ["./exports?password=S3cret", "configured postgres connection"],
  ])("%s -> %s", (fromExport, label) => {
    expect(registry.connectionLabel("postgres", { fromExport })).toBe(label);
  });
});
