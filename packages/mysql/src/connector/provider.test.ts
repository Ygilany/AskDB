import { describe, expect, it } from "vitest";
import { mysqlConnectorProvider } from "./provider.js";

const resolve = mysqlConnectorProvider.resolveConnection!;
const runtime = (mysqlDatabaseUrl?: string) => ({ introspection: { provider: "mysql", mysqlDatabaseUrl } });

describe("mysqlConnectorProvider", () => {
  it("resolves the configured URL, lets --url win, and redacts the label", () => {
    expect(resolve({ runtime: runtime("mysql://root:S3cret@db:3306/shop") })).toEqual({
      ok: true,
      connection: { url: "mysql://root:S3cret@db:3306/shop" },
      sourceLabel: "mysql://root:****@db:3306/shop",
    });
    const flag = resolve({ explicit: { url: "mysql://flag/db" }, runtime: runtime("mysql://config/db") });
    expect(flag.ok && flag.connection.url).toBe("mysql://flag/db");
  });

  it("phrases the missing-connection error per surface", () => {
    expect(resolve({ runtime: runtime(), surface: "cli" })).toEqual({
      ok: false,
      error:
        "Provide --url <mysql-url> (or set introspection.providerConfig.mysql.databaseUrl / ASKDB_INTROSPECT_MYSQL_URL / DATABASE_URL).",
    });
    expect(resolve({ runtime: runtime(), surface: "studio" })).toEqual({
      ok: false,
      error:
        "No MySQL connection configured. Set introspection.providerConfig.mysql.databaseUrl in askdb.config.ts (bound to an env var in .env).",
    });
  });
});
