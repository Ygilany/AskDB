import { describe, expect, it } from "vitest";
import { createConnectorRegistry } from "@askdb/connectors";
import { mysqlConnectorProvider } from "./connector/provider.js";

// The label hosts see: the adapter's parsed parts, built by the registry.
const registry = createConnectorRegistry([mysqlConnectorProvider]);
const connectionLabel = (url: string) => registry.connectionLabel("mysql", { url });

const FALLBACK = "configured mysql connection";

// Inputs that leaked a secret through the earlier masking redactor (review
// rounds 1-3 on #189/#195/#199) sit next to ordinary strings. A label only ever
// holds host, port and database parsed from a clean `mysql://` URL.
describe("mysql connection label (mysqlConnectorProvider.connectionLabelParts through the registry)", () => {
  it.each([
    // Ordinary strings.
    ["mysql://root:S3cret@localhost:3306/shop", "mysql://localhost:3306/shop"],
    ["mysql://localhost/shop?user=root&password=S3cret&ssl=true", "mysql://localhost/shop"],
    ["mysql://root:p@ss:w;rd@localhost/db", "mysql://localhost/db"],
    ["mysql://db:3306", "mysql://db:3306"],
    // Round 1: a password with an unencoded /, ? or # was echoed unchanged.
    ["mysql://root:pa/ss@db:3306/shop", FALLBACK],
    ["mysql://root:pa?ss@db:3306/shop", FALLBACK],
    ["mysql://root:p@ss#w0rd@db", FALLBACK],
    // Round 2: leading whitespace hid the URL from the redactor.
    [" mysql://root:S3cret@localhost:3306/shop", FALLBACK],
    // Round 3: a quoted value with trailing text leaked the tail.
    ["mysql://db/shop?password='ab'cd", "mysql://db/shop"],
    // Round 3: JDBC and near-miss URL forms came back unchanged.
    ["jdbc:mysql://root:secret@h:3306/shop", FALLBACK],
    ['"mysql://root:secret@h/shop"', FALLBACK],
    ["mysql:/root:secret@h/shop", FALLBACK],
    // Not a form mysql2 accepts.
    ["Server=localhost;Uid=root;Pwd=S3cret;Database=shop", FALLBACK],
  ])("%s -> %s", (input, label) => {
    expect(connectionLabel(input)).toBe(label);
  });
});
