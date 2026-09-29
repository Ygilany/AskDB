import { describe, expect, it } from "vitest";
import type { V2Table } from "@askdb/core";
import type { TableDraft } from "@askdb/enrich";
import { tableSensitivity } from "./sensitivity";

// Studio's Sensitivity and Enrichment tabs disable "Not sensitive" wherever
// `forced` is true, so this must match the core loader's escalate-only rule exactly.
const physical = (tableSensitive: boolean): V2Table => ({
  id: "table:public.users",
  name: "users",
  schema: "public",
  sensitive: tableSensitive,
  columns: [
    { id: "table:public.users#email", name: "email", type: "text", nullable: false, sensitive: true },
    { id: "table:public.users#ssn", name: "ssn", type: "text", nullable: true, sensitive: false },
  ],
});
const draft = (sensitive: boolean | undefined, columns: TableDraft["columns"] = {}): TableDraft => ({
  description: "",
  sensitive,
  columns,
});
const email = "table:public.users#email";
const ssn = "table:public.users#ssn";

describe("tableSensitivity", () => {
  it.each([
    {
      name: "schema.json-sensitive column is forced; a plain column is not",
      table: false,
      draft: draft(undefined, { [email]: { sensitive: false } }),
      expected: { forced: false, effective: false, columns: { [email]: { forced: true, effective: true }, [ssn]: { forced: false, effective: false } } },
    },
    {
      name: "a column override escalates without forcing",
      table: false,
      draft: draft(undefined, { [ssn]: { sensitive: true } }),
      expected: { forced: false, effective: false, columns: { [email]: { forced: true, effective: true }, [ssn]: { forced: false, effective: true } } },
    },
    {
      name: "a column another table's markdown escalates is forced",
      table: false,
      escalatedByOtherFiles: [ssn],
      draft: draft(undefined, { [ssn]: { sensitive: false } }),
      expected: { forced: false, effective: false, columns: { [email]: { forced: true, effective: true }, [ssn]: { forced: true, effective: true } } },
    },
    {
      name: "a table escalated by override forces every column, but not itself",
      table: false,
      draft: draft(true, { [ssn]: { sensitive: false } }),
      expected: { forced: false, effective: true, columns: { [email]: { forced: true, effective: true }, [ssn]: { forced: true, effective: true } } },
    },
    {
      name: "a schema.json-sensitive table is forced, and a table `false` override cannot un-mark it",
      table: true,
      draft: draft(false),
      expected: { forced: true, effective: true, columns: { [email]: { forced: true, effective: true }, [ssn]: { forced: true, effective: true } } },
    },
  ])("$name", ({ table, escalatedByOtherFiles, draft, expected }) => {
    expect(tableSensitivity({ physical: physical(table), escalatedByOtherFiles }, draft)).toEqual(expected);
  });
});
