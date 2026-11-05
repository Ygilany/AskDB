import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createConnectorRegistry } from "@askdb/introspect";
import { mysqlConnectorProvider } from "./connector/provider.js";
import { parseMysqlConnection } from "./label.js";

// The label hosts see: the adapter's parsed parts, built by the registry.
const registry = createConnectorRegistry([mysqlConnectorProvider]);
const connectionLabel = (url: string) => registry.connectionLabel("mysql", { url });

const FALLBACK = "configured mysql connection";

// Inputs that leaked a secret through the earlier masking redactor (ADR 0011,
// "Context") sit next to ordinary strings. The parts are
// read the way mysql2 reads them (ADR 0011).
const CORPUS: ReadonlyArray<readonly [input: string, label: string]> = [
  // Ordinary strings.
  ["mysql://root:S3cret@localhost:3306/shop", "mysql://localhost:3306/shop"],
  ["mysql://localhost/shop?user=root&password=S3cret&ssl=true", "mysql://localhost/shop"],
  ["mysql://root:p@ss:w;rd@localhost/db", "mysql://localhost/db"],
  ["mysql://db:3306", "mysql://db:3306"],
  // A password with an unencoded /, ? or # was echoed unchanged.
  ["mysql://root:pa/ss@db:3306/shop", FALLBACK],
  ["mysql://root:pa?ss@db:3306/shop", FALLBACK],
  ["mysql://root:p@ss#w0rd@db", FALLBACK],
  // Leading whitespace. WHATWG URL (and so mysql2) strips it.
  [" mysql://root:S3cret@localhost:3306/shop", "mysql://localhost:3306/shop"],
  // A quoted value with trailing text leaked the tail.
  ["mysql://db/shop?password='ab'cd", "mysql://db/shop"],
  // JDBC and near-miss URL forms came back unchanged.
  ["jdbc:mysql://root:secret@h:3306/shop", FALLBACK],
  ['"mysql://root:secret@h/shop"', FALLBACK],
  ["mysql:/root:secret@h/shop", FALLBACK],
  // Not a form mysql2 accepts.
  ["Server=localhost;Uid=root;Pwd=S3cret;Database=shop", FALLBACK],
];

describe("mysql connection label (mysqlConnectorProvider.connectionLabelParts through the registry)", () => {
  it.each(CORPUS)("%s -> %s", (input, label) => {
    expect(connectionLabel(input)).toBe(label);
  });
});

// Differential: mysql2's own URL parser (lib/connection_config.js isn't in its
// exports map, so it is loaded by path from the installed devDependency).
const mysql2Dir = dirname(createRequire(import.meta.url).resolve("mysql2/package.json"));
const { parseUrl } = createRequire(import.meta.url)(join(mysql2Dir, "lib/connection_config.js")) as {
  parseUrl(url: string): { host: string; port: number; database: string };
};

describe("mysql label parts match mysql2's ConnectionConfig.parseUrl", () => {
  const shown = CORPUS.map(([input]) => input).filter((input) => connectionLabel(input) !== FALLBACK);

  it.each(shown)("%s", (input) => {
    const parts = parseMysqlConnection(input) as { host?: string; port?: string; database?: string };
    const driver = parseUrl(input);
    expect(parts.host ?? "").toBe(driver.host);
    if (parts.port !== undefined) expect(Number(parts.port)).toBe(driver.port);
    expect(parts.database ?? "").toBe(driver.database);
  });
});
