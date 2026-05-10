import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSchema, loadSchemaFromJson } from "@askdb/core";
import { runTuiCli } from "./cli.js";

const FIXTURE = new URL(
  "../../../fixtures/schemas/orders-users.schema",
  import.meta.url,
).pathname;

describe("runTuiCli", () => {
  it("--version prints package version", async () => {
    const stdout: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stdout.write;

    try {
      const code = await runTuiCli(["--version"]);
      expect(code).toBe(0);
      expect(stdout.join("")).toMatch(/^\d+\.\d+\.\d+/);
    } finally {
      process.stdout.write = original;
    }
  });

  it("--help prints usage and exits 0", async () => {
    const stdout: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stdout.write;

    try {
      const code = await runTuiCli(["--help"]);
      expect(code).toBe(0);
      expect(stdout.join("")).toContain("askdb-tui");
      expect(stdout.join("")).toContain("--schema");
    } finally {
      process.stdout.write = original;
    }
  });

  it("missing --schema arg errors with exit code 1", async () => {
    const stderr: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stderr.write;

    try {
      const code = await runTuiCli(["--schema"]);
      expect(code).toBe(1);
      expect(stderr.join("")).toContain("requires a value");
    } finally {
      process.stderr.write = original;
    }
  });

  it("nonexistent schema directory errors with exit code 1", async () => {
    const stderr: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stderr.write;

    try {
      const code = await runTuiCli(["--schema", "/tmp/__askdb-tui-no-such-dir__"]);
      expect(code).toBe(1);
      expect(stderr.join("")).toContain("not found");
    } finally {
      process.stderr.write = original;
    }
  });

  it("bundle writes loader-compatible JSON", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "askdb-tui-bundle-"));
    const schemaDir = join(tmp, "orders-users.schema");
    const out = join(tmp, "bundle.json");
    cpSync(FIXTURE, schemaDir, { recursive: true });
    const originalStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = (() => true) as typeof process.stdout.write;

    try {
      const code = await runTuiCli(["bundle", schemaDir, "--out", out]);
      expect(code).toBe(0);
      expect(loadSchemaFromJson(readFileSync(out, "utf8"))).toEqual(loadSchema(schemaDir));
    } finally {
      process.stdout.write = originalStdout;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
