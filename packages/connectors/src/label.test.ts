import { describe, expect, it } from "vitest";
import { formatConnectionLabel, type ConnectionLabelParts } from "./label.js";

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
