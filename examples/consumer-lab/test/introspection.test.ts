/**
 * `askdb introspect`, as installed from the install target, on every fixture database.
 *
 * Protects: the documented CLI introspection path for each engine (`reference/cli.mdx`,
 * `guides/switch-engines.mdx`): `--engine`/`--url`/`--schemas` for Postgres, SQL Server,
 * MySQL and MariaDB, and `introspection.providerConfig.sqlite.file` for SQLite, run as the
 * read-only role. The artifact must match the golden logical schema under the rules in
 * `fixtures/multi-engine/dataset/NORMALIZATION.md`, load with the installed `@askdb/core`'s
 * `loadSchema` with no loader warnings (`docs/contracts/schema-v2.md`), and load to the same
 * schema again after `askdb bundle`.
 * Catches: a lost composite-FK column order, a dropped nullable or primary key, a missing
 * namespace or database, a mis-mapped type, a view or reserved-word table dropped by one
 * engine, a partition leaf leaking in; renderer output the installed core can't parse; a
 * bundle that loses tables or columns. Also a packed `askdb` whose CLI can't reach an
 * engine at all: a connector or driver missing from the tarballs, or a broken bin.
 * Not covered elsewhere: the packages' `multi-engine.integration.test.ts` suites call each
 * connector from workspace source. None of them runs the `askdb` binary from packed
 * tarballs, resolves drivers from a consumer project, or reads a consumer's
 * `askdb.config.ts`; that installed-CLI path is this file's distinct risk.
 * No production seam: only the installed `askdb` bin and `@askdb/core`'s public `loadSchema`.
 *
 * Needs the fixture (`pnpm fixture:up`) and an installed lab (`pnpm lab:use .`). It fails,
 * rather than skips, when either is missing.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSchema } from "@askdb/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireInstallTarget } from "../src/artifacts.js";
import { DIALECTS, compareToLogicalSchema, loadLogicalSchema, type SchemaJson } from "../src/fixture.js";
import { askdb, introspectFixture, type CliRun } from "../src/introspect.js";

const golden = loadLogicalSchema();
const goldenTableNames = [...golden.tables, ...golden.views].map((t) => t.name).sort();

for (const dialect of DIALECTS) {
  describe(`[${dialect}]`, () => {
    let workDir: string;
    let artifact: string;
    let run: CliRun;

    beforeAll(() => {
      requireInstallTarget();
      workDir = mkdtempSync(join(tmpdir(), `lab-introspect-${dialect}-`));
      artifact = join(workDir, "fixture.schema");
      run = introspectFixture(dialect, artifact);
    });

    afterAll(() => {
      if (workDir) rmSync(workDir, { recursive: true, force: true });
    });

    it("introspect-golden: askdb introspect matches schema.logical.json", () => {
      expect(run.status, run.stderr).toBe(0);
      const schemaJson = JSON.parse(readFileSync(join(artifact, "schema.json"), "utf8")) as SchemaJson;
      expect(compareToLogicalSchema(schemaJson, { expectNamespaces: dialect !== "sqlite" })).toEqual([]);
    });

    it("introspect-loads: loadSchema reads every table, with no warnings", () => {
      const schema = loadSchema(artifact);
      expect(schema.warnings).toEqual([]);
      expect(schema.schemaId).toBe("multi-engine");
      expect(schema.tables.map((t) => t.name).sort()).toEqual(goldenTableNames);
    });

    it("introspect-bundle: askdb bundle loads to the same schema", () => {
      const bundle = join(workDir, "fixture.schema.bundle.json");
      const bundled = askdb(["bundle", artifact, "--out", bundle]);
      expect(bundled.status, bundled.stderr).toBe(0);
      expect(loadSchema(bundle)).toEqual(loadSchema(artifact));
    });
  });
}
