import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Fixtures shared by the workspace test files. `tsconfig.build.json` leaves this
// file out of `dist`; `pnpm lint` type-checks it with the tests.

/** A physical table with one integer primary key, in schema `fname`. */
export const table = (schema: string, name: string) => ({
  id: `table:${schema}.${name}`,
  name,
  schema,
  sensitive: false,
  columns: [
    {
      id: `table:${schema}.${name}#id`,
      name: "id",
      type: "integer",
      nullable: false,
      primaryKey: true,
      sensitive: false,
    },
  ],
});

/** Write `schema.json` for `tables` and create an empty `tables/`. */
export function writeSchema(schemaDir: string, tables: ReturnType<typeof table>[]): void {
  mkdirSync(join(schemaDir, "tables"), { recursive: true });
  writeFileSync(
    join(schemaDir, "schema.json"),
    `${JSON.stringify({ version: 2, schemaId: "fname", tables }, null, 2)}\n`,
    "utf8",
  );
}

export const tableMd = (schema: string, name: string, description: string) =>
  `---\nid: table:${schema}.${name}\nname: ${name}\nschemaId: fname\n---\n\n# Table: ${name}\n\n${description}\n`;
