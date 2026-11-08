import { describe, expect, it } from "vitest";
import type { NormalizedSchemaV2, SchemaV2Warning } from "@askdb/core";
import { schemaWarningLines } from "./schema-warnings.js";

// The lines `askdb ask` and `askdb bundle` print on stderr (#690), one per loader warning kind.
describe("schemaWarningLines", () => {
  const cases: Array<[SchemaV2Warning, string]> = [
    [
      { kind: "orphaned_table_id", tableFile: "tables/gone.md", id: "table:public.gone" },
      "tables/gone.md names table table:public.gone, which schema.json doesn't have",
    ],
    [
      { kind: "orphaned_column_id", tableFile: "tables/orders.md", id: "table:public.orders#gone" },
      "tables/orders.md names column table:public.orders#gone, which schema.json doesn't have",
    ],
    [{ kind: "missing_table_md", tableId: "table:public.orders" }, "table table:public.orders has no file in tables/"],
    [
      { kind: "missing_column_md", tableId: "table:public.orders", columnId: "table:public.orders#id" },
      "column table:public.orders#id has no entry in table:public.orders's table file",
    ],
    [
      { kind: "sensitivity_downgrade_ignored", tableFile: "tables/users.md", id: "table:public.users#email" },
      "tables/users.md sets sensitive: false on table:public.users#email, which is sensitive anyway; sensitivity only escalates, so it stays sensitive",
    ],
    [
      { kind: "misplaced_column_id", tableFile: "tables/orders.md", id: "table:public.users#id", tableId: "table:public.users" },
      "tables/orders.md lists column table:public.users#id, which is on table:public.users; only its sensitive: true applies, so move the entry to that table's file",
    ],
    [
      { kind: "duplicate_column_id", tableFile: "tables/orders.md", id: "table:public.orders#id" },
      "tables/orders.md lists column table:public.orders#id more than once; only the first entry's description, aliases and enum apply",
    ],
  ];

  it.each(cases)("prints %j as one line", (warning, line) => {
    expect(schemaWarningLines({ warnings: [warning] })).toEqual([`Warning: ${line}\n`]);
  });

  it("prints the tenant policy's warnings after the schema's, with core's line for each", () => {
    const schema = {
      warnings: [cases[0]![0]],
      tenantPolicy: { warnings: [{ kind: "orphaned_global_table_id", id: "table:public.gone" }] },
    } as unknown as Pick<NormalizedSchemaV2, "warnings" | "tenantPolicy">;
    expect(schemaWarningLines(schema)).toEqual([
      `Warning: ${cases[0]![1]}\n`,
      "Warning: tenant-policy.md: global table table:public.gone is not in schema.json\n",
    ]);
  });

  it("prints nothing for a schema without warnings", () => {
    expect(schemaWarningLines({ warnings: [] })).toEqual([]);
  });
});
