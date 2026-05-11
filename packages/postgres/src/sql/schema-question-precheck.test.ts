import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AskDbError, loadNormalizedSchemaFromJson } from "@askdb/core";
import { assertNlToSqlInputs, nlToSqlAmbiguityNotes } from "./schema-question-precheck.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoFixturesDir = path.resolve(__dirname, "../../../../fixtures/schemas");

describe("schema-question-precheck", () => {
  it("assertNlToSqlInputs rejects empty schema tables", () => {
    expect(() =>
      assertNlToSqlInputs({ tables: [] }, "hello"),
    ).toThrowError(AskDbError);
  });

  it("assertNlToSqlInputs rejects blank question", () => {
    expect(() =>
      assertNlToSqlInputs(
        {
          tables: [
            {
              name: "t",
              columns: [{ name: "id", type: "int", nullable: false, primaryKey: true }],
            },
          ],
        },
        "  \n",
      ),
    ).toThrowError(AskDbError);
  });

  it("fixture orders-users: unknown FROM table yields a note mentioning known tables", async () => {
    const raw = await readFile(path.join(repoFixturesDir, "orders-users.schema.json"), "utf8");
    const schema = loadNormalizedSchemaFromJson(raw);
    const notes = nlToSqlAmbiguityNotes('List rows from inventory where id > 3', schema);
    expect(notes.some((n) => n.includes("inventory") && n.includes("Known tables"))).toBe(true);
  });

  it("single-table schema + join-style question yields ambiguity note", () => {
    const schema = {
      tables: [{ name: "users", columns: [{ name: "id", type: "int", nullable: false, primaryKey: true }] }],
    };
    const notes = nlToSqlAmbiguityNotes("Show me a left join between orders and users", schema);
    expect(notes.some((n) => n.includes("only one table"))).toBe(true);
  });
});
