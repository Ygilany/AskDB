import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { introspect } from "@askdb/introspect";
import type { SqlTemplate } from "@askdb/introspect";
import { createPostgresConnector } from "./index.js";
import {
  createSnapshotCatalogQueryRunner,
  loadCatalogSnapshot,
  type CatalogSnapshot,
} from "./test-utils.js";
import {
  POSTGRES_TEMPLATE_VERSION,
  POSTGRES_TEMPLATES,
  type PostgresSqlTemplateName,
} from "./templates.js";

const FIXTURE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../fixtures/introspect",
);

let workDir: string;
beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "askdb-introspect-bundle-"));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("describePostgresFromExport", () => {
  it("reads a CSV bundle and produces the same SqlSchema as live mode", async () => {
    const snapshot = loadFixture("orders-users.catalog.json");
    const bundleDir = join(workDir, "bundle");
    writeCsvBundle(bundleDir, snapshot);

    const connector = createPostgresConnector();
    const fromExport = await connector.describe({
      mode: "from-export",
      bundlePath: bundleDir,
    });
    const live = await connector.describe({
      mode: "live",
      runner: createSnapshotCatalogQueryRunner(snapshot),
    });

    expect(fromExport).toEqual(live);
  });

  it("renders a JSON bundle byte-identically to the live/snapshot path", async () => {
    const snapshot = loadFixture("orders-users.catalog.json");
    const bundleDir = join(workDir, "json-bundle");
    const fromExportDir = join(workDir, "from-export.schema");
    const liveDir = join(workDir, "live.schema");
    writeJsonBundle(bundleDir, snapshot);

    const connector = createPostgresConnector();
    const fromExport = await introspect(
      { mode: "from-export", bundlePath: bundleDir },
      { outDir: fromExportDir, schemaId: "orders-users" },
      { connector },
    );
    const live = await introspect(
      { mode: "live", runner: createSnapshotCatalogQueryRunner(snapshot) },
      { outDir: liveDir, schemaId: "orders-users" },
      { connector },
    );

    expect(fromExport.warnings).toEqual([]);
    expect(fromExport.schema).toEqual(live.schema);
    expect(readSchemaJson(fromExport.render!.schemaJsonPath)).toBe(
      readSchemaJson(live.render!.schemaJsonPath),
    );
  });

  it("applies filters after bundle ingestion and reports ambiguous filters", async () => {
    const snapshot = loadFixture("orders-users.catalog.json");
    const bundleDir = join(workDir, "bundle");
    writeCsvBundle(bundleDir, snapshot);

    const result = await createPostgresConnector().describe({
      mode: "from-export",
      bundlePath: bundleDir,
      filters: { tables: ["public.users", "public.missing"] },
    });

    expect(result.schema.schemas[0]!.tables.map((table) => table.name)).toEqual([
      "users",
    ]);
    expect(result.warnings).toEqual([
      { code: "ambiguous_filter", filter: "public.missing" },
    ]);
  });

  it("applies the default ['public'] schema filter to bundles", async () => {
    const snapshot = loadFixture("orders-users.catalog.json");
    const bundleDir = join(workDir, "bundle");
    writeCsvBundle(bundleDir, {
      ...snapshot,
      schemas: [...(snapshot.schemas ?? []), { schema_name: "private" }],
      tables: [
        ...(snapshot.tables ?? []),
        {
          schema_name: "private",
          table_name: "audit_log",
          relkind: "r",
          row_level_security: false,
          comment: null,
        },
      ],
    });

    const result = await createPostgresConnector().describe({
      mode: "from-export",
      bundlePath: bundleDir,
    });

    expect(result.schema.schemas.map((schema) => schema.name)).toEqual([
      "public",
    ]);
  });

  it("rejects bundles without manifest.json", async () => {
    const bundleDir = join(workDir, "bundle");
    mkdirSync(bundleDir, { recursive: true });

    await expect(
      createPostgresConnector().describe({
        mode: "from-export",
        bundlePath: bundleDir,
      }),
    ).rejects.toThrow(/missing manifest\.json/i);
  });

  it("rejects unknown engines and version mismatches", async () => {
    const bundleDir = join(workDir, "bundle");
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(
      join(bundleDir, "manifest.json"),
      JSON.stringify({ engine: "mysql", version: POSTGRES_TEMPLATE_VERSION }),
    );

    await expect(
      createPostgresConnector().describe({
        mode: "from-export",
        bundlePath: bundleDir,
      }),
    ).rejects.toThrow(/unsupported export bundle engine 'mysql'/i);

    writeFileSync(
      join(bundleDir, "manifest.json"),
      JSON.stringify({ engine: "postgres", version: 999 }),
    );
    await expect(
      createPostgresConnector().describe({
        mode: "from-export",
        bundlePath: bundleDir,
      }),
    ).rejects.toThrow(/unsupported export bundle version '999'/i);
  });

  it("rejects missing template files", async () => {
    const bundleDir = join(workDir, "bundle");
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(
      join(bundleDir, "manifest.json"),
      JSON.stringify({ engine: "postgres", version: POSTGRES_TEMPLATE_VERSION }),
    );

    await expect(
      createPostgresConnector().describe({
        mode: "from-export",
        bundlePath: bundleDir,
      }),
    ).rejects.toThrow(/missing schemas\.csv or schemas\.json/i);
  });
});

function loadFixture(name: string): CatalogSnapshot {
  return loadCatalogSnapshot(resolve(FIXTURE_DIR, name));
}

function writeCsvBundle(bundleDir: string, snapshot: CatalogSnapshot): void {
  mkdirSync(bundleDir, { recursive: true });
  writeManifest(bundleDir);
  for (const tpl of POSTGRES_TEMPLATES) {
    writeFileSync(
      join(bundleDir, `${tpl.name}.csv`),
      toCsv(tpl, snapshot[tpl.name] ?? []),
    );
  }
}

function writeJsonBundle(bundleDir: string, snapshot: CatalogSnapshot): void {
  mkdirSync(bundleDir, { recursive: true });
  const files: Partial<Record<PostgresSqlTemplateName, string>> = {};
  for (const tpl of POSTGRES_TEMPLATES) {
    const file = `${tpl.name}.json`;
    files[tpl.name] = file;
    writeFileSync(
      join(bundleDir, file),
      JSON.stringify(snapshot[tpl.name] ?? [], null, 2),
    );
  }
  writeManifest(bundleDir, files);
}

function writeManifest(
  bundleDir: string,
  files?: Partial<Record<PostgresSqlTemplateName, string>>,
): void {
  writeFileSync(
    join(bundleDir, "manifest.json"),
    JSON.stringify({ engine: "postgres", version: POSTGRES_TEMPLATE_VERSION, files }, null, 2),
  );
}

function toCsv(
  tpl: SqlTemplate,
  rows: ReadonlyArray<Record<string, unknown>>,
): string {
  const lines = [tpl.columns.join(",")];
  for (const row of rows) {
    lines.push(tpl.columns.map((column) => csvCell(row[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (!/[",\n\r]/.test(str)) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

function readSchemaJson(path: string): string {
  return readFileSync(path, "utf8");
}
