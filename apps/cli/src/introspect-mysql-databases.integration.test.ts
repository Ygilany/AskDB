/**
 * `askdb introspect` against the multi-engine fixture's MySQL, where each logical
 * schema is its own database.
 *
 * Protects: the user-facing contract for multi-database MySQL introspection:
 * `introspection.providerConfig.mysql.databases` in askdb.config.ts reaches the
 * connector (config → runtime → CLI → filters), and `--schemas` overrides it.
 * Catches: the config key being dropped anywhere along that path (the connector
 * test in @askdb/mysql passes filters directly and can't see this), or the flag
 * no longer taking precedence.
 *
 * Skipped unless ASKDB_FIXTURE_HOST is set; CI sets it with
 * ASKDB_REQUIRE_INTEGRATION=1, so a missing fixture fails instead of skipping.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { integrationSuite } from "../../../scripts/test-utils/integration.mjs";
import {
  FIXTURE_HOST_ENV,
  LOGICAL_SCHEMAS,
  compareToLogicalSchema,
  connectionUrl,
  type SchemaJson,
} from "../../../fixtures/multi-engine/src/index.js";

const repoRoot = join(import.meta.dirname, "../../..");
const cli = join(repoRoot, "apps/cli/dist/cli.js");
const fixtureSuite = integrationSuite({ env: [FIXTURE_HOST_ENV] });

let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "askdb-cli-mysql-databases-"));
  // Let jiti resolve `@askdb/config` from askdb.config.ts, as in a real project.
  mkdirSync(join(project, "node_modules/@askdb"), { recursive: true });
  symlinkSync(join(repoRoot, "packages/config"), join(project, "node_modules/@askdb/config"));
  writeFileSync(
    join(project, "askdb.config.ts"),
    `import { defineConfig, type AskDbConfig } from "@askdb/config";
export default defineConfig({
  ai: { provider: "openai", providerConfig: { openai: { apiKey: "unused" } } },
  introspection: {
    provider: "mysql",
    providerConfig: {
      mysql: {
        databaseUrl: ${JSON.stringify(connectionUrl("mysql", "reader"))},
        databases: ${JSON.stringify(LOGICAL_SCHEMAS)},
      },
    },
  },
  rag: { embedder: "mock", embedderConfig: {}, store: "memory", storeConfig: { memory: {} } },
} satisfies AskDbConfig);
`,
  );
});
afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

function introspect(extraArgs: string[]): SchemaJson {
  const out = join(project, "out.schema");
  const exec = spawnSync("node", [cli, "introspect", "--schema-id", "multi-engine", "--out", out, ...extraArgs], {
    cwd: project,
    encoding: "utf8",
  });
  expect(exec.stderr).not.toMatch(/error/i);
  expect(exec.status).toBe(0);
  return JSON.parse(readFileSync(join(out, "schema.json"), "utf8")) as SchemaJson;
}

fixtureSuite("askdb introspect: MySQL databases from config", () => {
  it("introspects every database listed in introspection.providerConfig.mysql.databases", () => {
    expect(compareToLogicalSchema(introspect([]), { expectNamespaces: true })).toEqual([]);
  });

  it("lets --schemas override the configured list", () => {
    const namespaces = new Set(introspect(["--schemas", "org,ref"]).tables.map((t) => t.schema));
    expect([...namespaces].sort()).toEqual(["org", "ref"]);
  });
});
