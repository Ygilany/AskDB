import { spawnSync } from "node:child_process";
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
import { describe, expect, it } from "vitest";
import { POSTGRES_TEMPLATE_VERSION, POSTGRES_TEMPLATES } from "./postgres/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const pkgDir = join(repoRoot, "packages/introspect");
const fixtureDir = join(repoRoot, "fixtures/introspect");

describe("askdb-introspect CLI", () => {
  it("prints Postgres templates", () => {
    buildPackage();
    const exec = runBin(["templates", "--engine", "postgres"]);
    expect(exec.status).toBe(0);
    expect(exec.stdout).toContain("-- schemas");
    expect(exec.stdout).toContain("ORDER BY");
    expect(exec.stderr).toBe("");
  });

  it("writes from-export bundles and supports --print and --diff", () => {
    buildPackage();
    const workDir = mkdtempSync(join(tmpdir(), "askdb-introspect-cli-"));
    try {
      const bundleDir = join(workDir, "bundle");
      const outDir = join(workDir, "orders-users.schema");
      writeJsonBundle(bundleDir);

      const write = runBin([
        "--from-export",
        bundleDir,
        "--out",
        outDir,
        "--schema-id",
        "orders-users",
      ]);
      expect(write.status).toBe(0);
      expect(readFileSync(join(outDir, "schema.json"), "utf8")).toContain(
        '"schemaId": "orders-users"',
      );

      const print = runBin([
        "--from-export",
        bundleDir,
        "--print",
        "--schema-id",
        "orders-users",
      ]);
      expect(print.status).toBe(0);
      expect(JSON.parse(print.stdout)).toMatchObject({
        version: 2,
        schemaId: "orders-users",
      });

      const diff = runBin([
        "--from-export",
        bundleDir,
        "--diff",
        outDir,
        "--schema-id",
        "orders-users",
      ]);
      expect(diff.status).toBe(0);
      expect(JSON.parse(diff.stdout)).toMatchObject({ changed: false });
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("emits structured introspection logs", () => {
    buildPackage();
    const workDir = mkdtempSync(join(tmpdir(), "askdb-introspect-logs-"));
    try {
      const bundleDir = join(workDir, "bundle");
      const outDir = join(workDir, "orders-users.schema");
      const logFile = join(workDir, "introspect.log");
      writeJsonBundle(bundleDir);

      const exec = runBin([
        "--from-export",
        bundleDir,
        "--out",
        outDir,
        "--schema-id",
        "orders-users",
        "--log-file",
        logFile,
        "--correlation-id",
        "introspect-test-correlation",
      ]);
      expect(exec.status).toBe(0);

      const records = readFileSync(logFile, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(records.every((record) => record.correlationId === "introspect-test-correlation")).toBe(true);
      const events = new Set(records.map((record) => record.event));
      expect(events.has("askdb.introspect.started")).toBe(true);
      expect(events.has("askdb.introspect.completed")).toBe(true);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});

function buildPackage(): void {
  const build = spawnSync("pnpm", ["-C", pkgDir, "build"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  expect(build.status, build.stderr || build.stdout).toBe(0);
}

function runBin(args: string[]) {
  return spawnSync("node", [join(pkgDir, "dist/bin.js"), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function writeJsonBundle(bundleDir: string): void {
  mkdirSync(bundleDir, { recursive: true });
  const snapshot = JSON.parse(
    readFileSync(join(fixtureDir, "orders-users.catalog.json"), "utf8"),
  ) as Partial<Record<string, unknown[]>>;
  const files: Record<string, string> = {};
  for (const tpl of POSTGRES_TEMPLATES) {
    const file = `${tpl.name}.json`;
    files[tpl.name] = file;
    writeFileSync(
      join(bundleDir, file),
      JSON.stringify(snapshot[tpl.name] ?? [], null, 2),
    );
  }
  writeFileSync(
    join(bundleDir, "manifest.json"),
    JSON.stringify({ engine: "postgres", version: POSTGRES_TEMPLATE_VERSION, files }, null, 2),
  );
}
