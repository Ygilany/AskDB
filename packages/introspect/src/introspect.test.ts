import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { introspect } from "./introspect.js";
import type { Connector, IntrospectionResult, SqlSchema } from "./types.js";

let workDir: string;
beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "askdb-introspect-e2e-"));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

type FakeInput = { tag: string };

const fakeSchema: SqlSchema = {
  schemaId: "fake",
  schemas: [
    {
      name: "public",
      tables: [
        {
          id: "table:public.users",
          schema: "public",
          name: "users",
          columns: [
            {
              id: "table:public.users#id",
              name: "id",
              ordinalPosition: 1,
              dataType: "uuid",
              udtName: "uuid",
              nullable: false,
              primaryKey: true,
            },
          ],
          primaryKey: { columns: ["id"] },
          foreignKeys: [],
          uniqueConstraints: [],
          indexes: [],
          checkConstraints: [],
        },
      ],
      views: [],
      enums: [],
      sequences: [],
    },
  ],
};

function makeFakeConnector(calls: string[]): Connector<FakeInput> {
  return {
    async describe(input): Promise<IntrospectionResult> {
      calls.push(input.tag);
      return {
        schema: fakeSchema,
        warnings: [],
        isEmpty: false,
        viewDefinitions: {},
      };
    },
  };
}

describe("introspect() — engine-agnostic orchestrator", () => {
  it("delegates to the supplied connector and returns its IntrospectionResult when no renderOptions are passed", async () => {
    const calls: string[] = [];
    const connector = makeFakeConnector(calls);
    const result = await introspect<FakeInput>({ tag: "hello" }, undefined, { connector });

    expect(calls).toEqual(["hello"]);
    expect(result.schema.schemaId).toBe("fake");
    expect(result.render).toBeUndefined();
  });

  it("writes the rendered Schema v2 directory when renderOptions are supplied", async () => {
    const connector = makeFakeConnector([]);
    const outDir = join(workDir, "fake.schema");

    const result = await introspect<FakeInput>(
      { tag: "render" },
      { outDir, schemaId: "fake" },
      { connector },
    );

    expect(result.render?.schemaJsonPath).toBe(join(outDir, "schema.json"));
    const written = readFileSync(result.render!.schemaJsonPath, "utf8");
    expect(written).toContain('"schemaId": "fake"');
    expect(written).toContain('"table:public.users"');
  });

  it("merges connector and render warnings", async () => {
    const connector: Connector<FakeInput> = {
      async describe() {
        return {
          schema: fakeSchema,
          warnings: [{ code: "ambiguous_filter", filter: "public.missing" }],
          isEmpty: false,
          viewDefinitions: {},
        };
      },
    };
    const outDir = join(workDir, "fake.schema");
    const result = await introspect<FakeInput>(
      { tag: "warn" },
      { outDir, schemaId: "fake" },
      { connector },
    );

    expect(result.warnings).toEqual([
      { code: "ambiguous_filter", filter: "public.missing" },
    ]);
  });
});
