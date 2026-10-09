import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Fixtures shared by the workspace test files. Not part of the build.

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

/**
 * A group, other than the one new files in a temp directory get, that this
 * process belongs to and so may give a file.
 */
export const otherGroup = (() => {
  if (process.platform === "win32") return undefined;
  const dir = mkdtempSync(join(tmpdir(), "askdb-enrich-gid-"));
  const newFileGid = statSync(dir).gid;
  rmSync(dir, { recursive: true });
  return process.getgroups?.().find((g) => g !== newFileGid && g !== process.getegid?.());
})();

/** Why a test that gives a file `otherGroup` can't run here, or `false`. */
export const otherGroupUnavailable =
  process.platform === "win32"
    ? "POSIX owners and groups are required (not Windows)"
    : otherGroup === undefined
      ? "this user belongs to no second group to give the file"
      : false;
