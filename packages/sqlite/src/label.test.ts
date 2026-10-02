import { describe, expect, it } from "vitest";
import { createConnectorRegistry } from "@askdb/introspect";
import { sqliteConnectorProvider } from "./connector/provider.js";

// The label hosts see: the adapter's parsed parts, built by the registry.
const registry = createConnectorRegistry([sqliteConnectorProvider]);
const connectionLabel = (url: string) => registry.connectionLabel("sqlite", { url });

const FALLBACK = "configured sqlite connection";

// Inputs that leaked a secret through the earlier masking redactor (review
// rounds 2-3 on #189/#195/#199) sit next to ordinary paths. A label is the file
// path only; a `file:` URI's query string is never read.
describe("sqlite connection label (sqliteConnectorProvider.connectionLabelParts through the registry)", () => {
  it.each([
    // Ordinary paths.
    ["./data/app.db", "./data/app.db"],
    [":memory:", ":memory:"],
    ["/var/lib/app/app.db", "/var/lib/app/app.db"],
    ["C:\\data\\app.db", "C:\\data\\app.db"],
    ["file:./data/app.db?mode=ro&cache=shared", "./data/app.db"],
    ["file:///srv/app.db?mode=ro", "/srv/app.db"],
    ["file://localhost/srv/app.db", "/srv/app.db"],
    // Round 2: encryption keys in a file: URI query.
    ["file:./data/app.db?mode=ro&key=S3cret&cache=shared", "./data/app.db"],
    ["file:app.db?hexkey=2DD29CA8&password=S3cret", "app.db"],
    ["file:app.db?key=S3&cret&mode=ro", "app.db"],
    // Round 3: a percent-encoded key name was not recognised as a secret.
    ["file:app.db?%6Bey=secret", "app.db"],
    ["file:app.db?k%65y=secret", "app.db"],
    // Not a plain path or a local file: URI.
    ["./app.db?key=S3cret", FALLBACK],
    ["Data Source=app.db;Password=S3cret", FALLBACK],
    ["file://remote-host/app.db", FALLBACK],
    ["file:app.db#key=S3cret", FALLBACK],
    ["postgres://u:S3cret@h/db", FALLBACK],
  ])("%s -> %s", (input, label) => {
    expect(connectionLabel(input)).toBe(label);
  });
});
