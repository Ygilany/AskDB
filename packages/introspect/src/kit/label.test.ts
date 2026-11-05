import { describe, expect, it } from "vitest";
import { formatConnectionLabel, parseConnectionUrl, type ConnectionLabelParts } from "./label.js";

// The builder is the allowlist every engine's label goes through, including a
// third-party engine's parser that returns a part it should not have.
describe("formatConnectionLabel", () => {
  it.each<[ConnectionLabelParts | undefined, string]>([
    [{ host: "db", port: "5432", database: "app" }, "acme://db:5432/app"],
    [{ host: "[::1]" }, "acme://[::1]"],
    [{ database: "app" }, "acme:///app"],
    [{ file: "./data/app.db" }, "./data/app.db"],
    [undefined, "configured acme connection"],
    [{}, "configured acme connection"],
    [{ host: "u:secret@db" }, "configured acme connection"],
    [{ host: "db", port: "se" }, "configured acme connection"],
    [{ port: "5432" }, "configured acme connection"],
    [{ host: "db", database: "app?password=secret" }, "configured acme connection"],
    [{ host: "db", database: "a/b" }, "configured acme connection"],
    [{ file: "app.db?key=secret" }, "configured acme connection"],
    [{ file: "Data Source=app.db;Password=secret" }, "configured acme connection"],
    [{ file: "postgres://u:secret@h/db" }, "configured acme connection"],
  ])("%j -> %s", (parts, label) => {
    expect(formatConnectionLabel("acme", parts)).toBe(label);
  });
});

// The strict parser offered to third-party engines whose driver has no parser
// to reuse: it returns only host, port and database, and undefined for anything
// it can't classify, so the label falls back.
describe("parseConnectionUrl", () => {
  const SCHEMES = ["acme", "acmes"];
  it.each<[string, ConnectionLabelParts | undefined]>([
    ["acme://u:S3cret@db:1521/orcl?sslmode=require", { host: "db", port: "1521", database: "orcl" }],
    ["ACME://db/orcl", { host: "db", database: "orcl" }],
    ["acmes://db", { host: "db" }],
    ["acme://u:S3cret@[::1]:1521/orcl", { host: "[::1]", port: "1521", database: "orcl" }],
    ["acme:///orcl", { database: "orcl" }],
    // Another scheme, or a near-miss of this one.
    ["postgres://u:S3cret@db/app", undefined],
    ["jdbc:acme://u:S3cret@db/orcl", undefined],
    ['"acme://u:S3cret@db/orcl"', undefined],
    ["acme:/u:S3cret@db/orcl", undefined],
    // Whitespace, control characters and fragments.
    [" acme://db/orcl", undefined],
    ["acme://u:S3 cret@db/orcl", undefined],
    ["acme://db/orcl\n", undefined],
    ["acme://u:pa#ss@db/orcl", undefined],
    // An @ after the authority: a password with / or ? cut it short.
    ["acme://u:pa/ss@db/orcl", undefined],
    ["acme://u:12?x@db/orcl", undefined],
    // Not a single host[:port], or a multi-segment path.
    ["acme://h1:1521,h2:1521:x/orcl", undefined],
    ["acme://[::1/orcl", undefined],
    ["acme://[::1]x/orcl", undefined],
    ["acme://db/orcl/extra", undefined],
  ])("%s", (input, parts) => {
    expect(parseConnectionUrl(input, SCHEMES)).toEqual(parts);
  });
});
