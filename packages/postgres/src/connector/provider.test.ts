import { describe, expect, it } from "vitest";
import { postgresConnectorProvider } from "./provider.js";

const resolve = postgresConnectorProvider.resolveConnection!;
const runtime = (postgresDatabaseUrl?: string) => ({ introspection: { provider: "postgres", postgresDatabaseUrl } });

describe("postgresConnectorProvider.resolveConnection", () => {
  it("falls back to the configured URL and redacts it in the source label", () => {
    expect(resolve({ runtime: runtime("postgres://app:S3cret@db:5432/app"), surface: "studio" })).toEqual({
      ok: true,
      connection: { url: "postgres://app:S3cret@db:5432/app", fromExport: undefined },
      sourceLabel: "postgres://app:****@db:5432/app",
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
