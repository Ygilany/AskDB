import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "../../..");
const cliDir = join(repoRoot, "apps/cli");
const corePkgDir = join(repoRoot, "packages/core");
const introspectDir = join(repoRoot, "packages/introspect");
const postgresDir = join(repoRoot, "packages/postgres");
const prismaDir = join(repoRoot, "packages/prisma");
const prismaFixture = join(prismaDir, "test-fixtures/simple/schema.prisma");

describe("cli spawn: introspect subcommand", () => {
  beforeAll(() => {
    expect(run("pnpm", ["-C", corePkgDir, "build"]).status).toBe(0);
    expect(run("pnpm", ["-C", introspectDir, "build"]).status).toBe(0);
    expect(run("pnpm", ["-C", postgresDir, "build"]).status).toBe(0);
    expect(run("pnpm", ["-C", prismaDir, "build"]).status).toBe(0);
    expect(run("pnpm", ["-C", cliDir, "build"]).status).toBe(0);
  });

  it("runs `askdb introspect templates` via the in-tree Postgres connector", () => {
    const exec = run("node", [
      join(cliDir, "dist/cli.js"),
      "introspect",
      "templates",
      "--engine",
      "postgres",
    ]);

    expect(exec.status).toBe(0);
    expect(exec.stdout).toContain("-- schemas");
    expect(exec.stdout).toContain("ORDER BY");
  });

  it("rejects Prisma templates because Prisma introspection reads schema files", () => {
    const exec = run("node", [
      join(cliDir, "dist/cli.js"),
      "introspect",
      "templates",
      "--engine",
      "prisma",
    ]);

    expect(exec.status).toBe(1);
    expect(exec.stderr).toContain("does not provide SQL templates");
  });

  it("prints Schema v2 JSON from a Prisma schema file", () => {
    const exec = run("node", [
      join(cliDir, "dist/cli.js"),
      "introspect",
      "--engine",
      "prisma",
      "--prisma-schema",
      prismaFixture,
      "--schema-id",
      "simple",
      "--print",
    ]);

    expect(exec.status).toBe(0);
    expect(exec.stdout).toContain('"schemaId": "simple"');
    expect(exec.stdout).toContain('"id": "table:public.User"');
  });

  it("auto-discovers prisma schema or errors with a helpful message when none is found", () => {
    const exec = run("node", [
      join(cliDir, "dist/cli.js"),
      "introspect",
      "--engine",
      "prisma",
      "--print",
    ]);

    // The repo root has no prisma/schema.prisma, so discovery fails with a clear message.
    expect(exec.status).toBe(1);
    expect(exec.stderr).toContain("auto-discover");
  });

  it("writes schema to --out directory for Prisma introspection", () => {
    const tmp = mkdtempSync(join(tmpdir(), "askdb-introspect-out-"));
    try {
      const exec = run(
        "node",
        [
          join(cliDir, "dist/cli.js"),
          "introspect",
          "--engine",
          "prisma",
          "--prisma-schema",
          prismaFixture,
          "--schema-id",
          "simple",
          "--out",
          tmp,
        ],
        undefined,
        repoRoot,
      );
      expect(exec.status).toBe(0);
      expect(readFileSync(join(tmp, "schema.json"), "utf8")).toContain('"id": "table:public.User"');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("supports Prisma diff and out modes", () => {
    const tmp = mkdtempSync(join(tmpdir(), "askdb-prisma-cli-"));
    try {
      const existing = join(tmp, "existing.schema");
      const out = join(tmp, "out.schema");
      run("mkdir", ["-p", existing]);
      writeFileSync(join(existing, "schema.json"), "{}\n", "utf8");

      const diff = run("node", [
        join(cliDir, "dist/cli.js"),
        "introspect",
        "--engine",
        "prisma",
        "--prisma-schema",
        prismaFixture,
        "--diff",
        existing,
      ]);
      expect(diff.status).toBe(0);
      expect(JSON.parse(diff.stdout)).toMatchObject({ changed: true });

      const write = run("node", [
        join(cliDir, "dist/cli.js"),
        "introspect",
        "--engine",
        "prisma",
        "--prisma-schema",
        prismaFixture,
        "--schema-id",
        "simple",
        "--out",
        out,
      ]);
      expect(write.status).toBe(0);
      expect(readFileSync(join(out, "schema.json"), "utf8")).toContain(
        '"id": "table:public.User"',
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

function run(
  command: string,
  args: string[],
  extraEnv?: Record<string, string>,
  cwd: string = repoRoot,
) {
  return spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
  });
}
