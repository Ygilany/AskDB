/**
 * `askdb introspect` with `introspection.schemas` in askdb.config.ts, against the
 * multi-engine fixture.
 *
 * Protects: the user-facing contract for the configured schema list. On any engine,
 * `introspection.schemas` reaches the connector (config → runtime → CLI → filters), and
 * `--schemas` overrides it. On MySQL, where each logical schema is its own database,
 * that is what makes multi-database introspection reachable from config.
 * Catches: the config key being dropped anywhere along that path (the connector tests
 * pass filters directly and can't see this), the list reaching only one engine, or the
 * flag no longer taking precedence.
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
  project = mkdtempSync(join(tmpdir(), "askdb-cli-config-schemas-"));
  // Let jiti resolve `@askdb/config` from askdb.config.ts, as in a real project.
  mkdirSync(join(project, "node_modules/@askdb"), { recursive: true });
  symlinkSync(join(repoRoot, "packages/config"), join(project, "node_modules/@askdb/config"));
});
afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

/** An askdb.config.ts that introspects `provider` at `url`, listing `schemas`. */
function writeConfig(provider: "mysql" | "postgres", url: string, schemas: readonly string[]): void {
  writeFileSync(
    join(project, "askdb.config.ts"),
    `import { defineConfig, type AskDbConfig } from "@askdb/config";
export default defineConfig({
  ai: { provider: "openai", providerConfig: { openai: { apiKey: "unused" } } },
  introspection: {
    provider: ${JSON.stringify(provider)},
    providerConfig: { ${provider}: { databaseUrl: ${JSON.stringify(url)} } },
    schemas: ${JSON.stringify(schemas)},
  },
  rag: { embedder: "mock", store: "memory", storeConfig: { memory: {} } },
} satisfies AskDbConfig);
`,
  );
}

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

const namespaces = (schema: SchemaJson) => [...new Set(schema.tables.map((t) => t.schema))].sort();

fixtureSuite("askdb introspect: introspection.schemas from config", () => {
  it("introspects every MySQL database listed in introspection.schemas", () => {
    writeConfig("mysql", connectionUrl("mysql", "reader"), LOGICAL_SCHEMAS);
    expect(compareToLogicalSchema(introspect([]), { expectNamespaces: true })).toEqual([]);
  });

  it("lets --schemas override the configured list", () => {
    writeConfig("mysql", connectionUrl("mysql", "reader"), LOGICAL_SCHEMAS);
    expect(namespaces(introspect(["--schemas", "org,ref"]))).toEqual(["org", "ref"]);
  });

  it("applies the configured list on Postgres too", () => {
    // Without a list, Postgres reads every non-system schema (org, people, billing, ref, …).
    writeConfig("postgres", connectionUrl("postgres", "reader"), ["org", "ref"]);
    expect(namespaces(introspect([]))).toEqual(["org", "ref"]);
  });
});
