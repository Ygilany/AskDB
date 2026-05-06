import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SchemaParseError } from "../errors.js";
import { loadNormalizedSchemaFromJson, parseAskDbSchemaJson } from "./parse.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "../../../../fixtures/schemas/orders-users.schema.json");

describe("parseAskDbSchemaJson", () => {
  it("parses the shared fixture", () => {
    const raw = readFileSync(fixturePath, "utf8");
    const parsed = parseAskDbSchemaJson(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.tables.map((t) => t.name)).toEqual(["users", "orders"]);
  });

  it("normalizes nullable and primaryKey defaults", () => {
    const raw = readFileSync(fixturePath, "utf8");
    const norm = loadNormalizedSchemaFromJson(raw);
    const u = norm.tables.find((t) => t.name === "users");
    expect(u?.columns.find((c) => c.name === "id")).toMatchObject({
      nullable: false,
      primaryKey: true,
    });
  });

  it("rejects invalid JSON payload", () => {
    expect(() => parseAskDbSchemaJson("{}")).toThrow(SchemaParseError);
  });

  it("rejects duplicate tables", () => {
    const bad = JSON.stringify({
      version: 1,
      tables: [
        { name: "a", columns: [{ name: "x", type: "int" }] },
        { name: "a", columns: [{ name: "y", type: "int" }] },
      ],
    });
    expect(() => parseAskDbSchemaJson(bad)).toThrow(SchemaParseError);
  });

  it("rejects duplicate columns in a table", () => {
    const bad = JSON.stringify({
      version: 1,
      tables: [{ name: "a", columns: [
        { name: "x", type: "int" },
        { name: "x", type: "text" },
      ] }],
    });
    expect(() => parseAskDbSchemaJson(bad)).toThrow(SchemaParseError);
  });
});
