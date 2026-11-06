import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AskDbError } from "../errors.js";
import { loadNormalizedSchemaFromJson } from "../schema/parse.js";
import { loadSchemaFromJson } from "../schema/v2/loader.js";
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

  it("fixture orders-users: unknown FROM table yields a note naming it, and no schema table (#677)", async () => {
    const raw = await readFile(path.join(repoFixturesDir, "orders-users.schema.json"), "utf8");
    const schema = loadNormalizedSchemaFromJson(raw);
    const notes = nlToSqlAmbiguityNotes('List rows from inventory where id > 3', schema);
    expect(notes).toEqual(['The question mentions table "inventory" which is not in the schema.']);
  });

  it("single-table schema + join-style question yields ambiguity note", () => {
    const schema = {
      tables: [{ name: "users", columns: [{ name: "id", type: "int", nullable: false, primaryKey: true }] }],
    };
    const notes = nlToSqlAmbiguityNotes("Show me a left join between orders and users", schema);
    expect(notes.some((n) => n.includes("only one table"))).toBe(true);
  });

  describe("names no schema table, so an untracked one never reaches the prompt (#677)", () => {
    // `tracked` comes from a table's markdown front-matter, not schema.json, so it's set on the
    // loaded table, which is what ask() receives.
    const table = (name: string, tracked?: boolean) => ({
      id: `table:public.${name}`,
      name,
      schema: "public",
      tracked,
      columns: [{ id: `table:public.${name}#id`, name: "id", type: "integer", nullable: false, primaryKey: true }],
    });
    const schemaOf = (...tables: ReturnType<typeof table>[]) => {
      const schema = loadSchemaFromJson(JSON.stringify({ version: 2, schemaId: "hint", tables: tables.map(({ tracked: _t, ...t }) => t) }));
      tables.forEach((t, i) => {
        if (t.tracked !== undefined) schema.tables[i]!.tracked = t.tracked;
      });
      return schema;
    };

    it("leaves an untracked table out of the note for an unknown name", () => {
      // "from last month" reads as a table named `last`.
      const notes = nlToSqlAmbiguityNotes("show orders from last month", schemaOf(table("orders"), table("hidden_payroll", false)));
      expect(notes).toEqual(['The question mentions table "last" which is not in the schema.']);
    });

    it("counts only tracked tables for the single-table note, and names none", () => {
      const notes = nlToSqlAmbiguityNotes("join users with anything", schemaOf(table("users"), table("hidden_payroll", false)));
      expect(notes).toEqual([
        "The schema lists only one table. Do not invent joins to other tables unless their names appear explicitly in the schema excerpt.",
      ]);
    });

    it("checks the question against tracked tables only", () => {
      // An untracked table isn't in the prompt, so to the model it isn't in the schema.
      const notes = nlToSqlAmbiguityNotes("rows from hidden_payroll", schemaOf(table("orders"), table("hidden_payroll", false)));
      expect(notes).toEqual(['The question mentions table "hidden_payroll" which is not in the schema.']);
    });
  });
});
