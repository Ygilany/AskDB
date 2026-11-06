import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnectorRegistry, type CatalogQueryRunner, type ConnectorConnectionRequest } from "@askdb/introspect";
import type { PostgresIntrospectionInput } from "./index.js";
import { postgresConnectorProvider } from "./provider.js";
import { POSTGRES_TEMPLATE_VERSION, POSTGRES_TEMPLATES } from "./templates.js";

// Through the registry, which adds the label built from the adapter's parts (ADR 0011).
const registry = createConnectorRegistry([postgresConnectorProvider]);
const resolve = (request: ConnectorConnectionRequest) => registry.resolveConnection("postgres", request);
const runtime = (postgresDatabaseUrl?: string) => ({ introspection: { provider: "postgres", postgresDatabaseUrl } });

describe("postgresConnectorProvider.resolveConnection", () => {
  it("falls back to the configured URL and labels it by host and database only", () => {
    expect(resolve({ runtime: runtime("postgres://app:S3cret@db:5432/app"), surface: "studio" })).toEqual({
      ok: true,
      connection: { url: "postgres://app:S3cret@db:5432/app", fromExport: undefined },
      sourceLabel: "postgres://db:5432/app",
    });
  });

  it("lets an explicit --url win over config", () => {
    const resolved = resolve({ explicit: { url: "postgres://flag/db" }, runtime: runtime("postgres://config/db") });
    expect(resolved.ok && resolved.connection.url).toBe("postgres://flag/db");
  });

  it("uses an export bundle without consulting config", () => {
    expect(resolve({ explicit: { fromExport: "./bundle" }, runtime: runtime("postgres://config/db") })).toEqual({
      ok: true,
      connection: { url: undefined, fromExport: "./bundle" },
      sourceLabel: "./bundle",
    });
  });

  it("phrases the missing-connection error per surface", () => {
    expect(resolve({ runtime: runtime(), surface: "cli" })).toEqual({
      ok: false,
      error: "Provide either --url <postgres-url> or --from-export <bundle-dir>.",
    });
    expect(resolve({ runtime: runtime(), surface: "studio" })).toEqual({
      ok: false,
      error:
        "No Postgres connection configured. Set introspection.providerConfig.postgres.databaseUrl in askdb.config.ts (bound to an env var in .env).",
    });
  });

  it("rejects a Prisma schema path", () => {
    expect(resolve({ explicit: { schemaPath: "x.prisma" }, runtime: runtime("postgres://config/db") })).toEqual({
      ok: false,
      error: "Use --prisma-schema only with --engine prisma.",
    });
  });
});

describe("postgresConnectorProvider.createConnector", () => {
  const filters = { schemas: ["public"] };

  it("reads an export bundle even when a URL is also given", () => {
    const result = postgresConnectorProvider.createConnector({
      provider: "postgres",
      url: "postgres://db/app",
      fromExport: "./bundle",
      filters,
    });
    expect(result.mode).toBe("from-export");
    expect(result.input).toEqual({ mode: "from-export", bundlePath: "./bundle", filters });
  });

  it("requires a URL or an export bundle", () => {
    expect(() => postgresConnectorProvider.createConnector({ provider: "postgres" })).toThrow(
      /requires a connection URL/,
    );
  });

  it("introspects live from a URL alone, without connecting at creation", () => {
    const result = postgresConnectorProvider.createConnector({ provider: "postgres", url: "postgres://db/app", filters });
    expect(result.mode).toBe("live");
    expect(result.input).toEqual({ mode: "live", runner: expect.any(Function), filters });
  });
});

describe("postgresConnectorProvider.createConnector schemaId", () => {
  // An empty catalog in each mode: a runner that returns no rows, and an export bundle of empty files.
  const emptyCatalog: CatalogQueryRunner = async () => ({ columns: [], rows: [] });
  let bundleDir: string;
  beforeAll(() => {
    bundleDir = mkdtempSync(join(tmpdir(), "askdb-pg-schema-id-"));
    const files = Object.fromEntries(POSTGRES_TEMPLATES.map((tpl) => [tpl.name, `${tpl.name}.json`]));
    for (const file of Object.values(files)) writeFileSync(join(bundleDir, file), "[]");
    writeFileSync(
      join(bundleDir, "manifest.json"),
      JSON.stringify({ engine: "postgres", version: POSTGRES_TEMPLATE_VERSION, files }),
    );
  });
  afterAll(() => rmSync(bundleDir, { recursive: true, force: true }));

  it.each([
    ["live", "shop", "shop"],
    ["live", undefined, "introspected"],
    ["from-export", "shop", "shop"],
    ["from-export", undefined, "introspected"],
  ])("%s: turns config.schemaId %s into SqlSchema.schemaId %s", async (mode, schemaId, expected) => {
    const connection = mode === "live" ? { url: "postgres://db/app" } : { fromExport: bundleDir };
    const { connector, input } = postgresConnectorProvider.createConnector({ provider: "postgres", ...connection, schemaId });
    const described = input as PostgresIntrospectionInput;
    const result = await connector.describe(described.mode === "live" ? { ...described, runner: emptyCatalog } : described);
    expect(result.schema.schemaId).toBe(expected);
  });
});
