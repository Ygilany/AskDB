import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAskDbRuntimeForTests, setAskDbRuntimeForTests } from "@askdb/config";
import { createMockEmbedder, runRagCli } from "./cli.js";

const FIXTURE_DIR = resolve(__dirname, "../../../fixtures/schemas/orders-users.schema");

const tempDirs: string[] = [];
let stdout: string[];
let stderr: string[];

function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "askdb-rag-cli-"));
  tempDirs.push(dir);
  const schemaDir = join(dir, "orders-users.schema");
  cpSync(FIXTURE_DIR, schemaDir, { recursive: true });
  return schemaDir;
}

beforeEach(() => {
  setAskDbRuntimeForTests({
    structured: {
      ai: { provider: "openai", providerConfig: { openai: { apiKey: "k", model: "m" } } },
      introspection: {
        provider: "postgres",
        providerConfig: { postgres: { databaseUrl: "postgres://localhost/db" } },
        outputDir: "./askdb/",
      },
      rag: { embedder: "mock", embedderConfig: {}, store: "file", storeConfig: { file: {} } },
    },
    flat: {},
  });
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  resetAskDbRuntimeForTests();
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("askdb-rag CLI", () => {
  it("mock embedder honors --dimensions", async () => {
    expect((await createMockEmbedder(16)(["orders"]))[0]).toHaveLength(16);

    const schemaDir = copyFixture();
    expect(await runRagCli(["index", schemaDir, "--dimensions", "16"])).toBe(0);
    const meta = JSON.parse(readFileSync(join(schemaDir, "schema.embeddings.json"), "utf8")) as {
      dimensions: number;
    };
    expect(meta.dimensions).toBe(16);
    const lock = JSON.parse(readFileSync(join(schemaDir, "schema.lock.json"), "utf8")) as {
      embedderId: string;
      dimensions: number;
    };
    expect(lock).toMatchObject({ embedderId: "mock:lexical-16", dimensions: 16 });
  });

  it("query refuses an embedder that differs from the one the index was built with", async () => {
    const schemaDir = copyFixture();
    expect(await runRagCli(["index", schemaDir])).toBe(0);
    expect(await runRagCli(["query", schemaDir, "--question", "paid orders"])).toBe(0);

    stderr = [];
    expect(
      await runRagCli(["query", schemaDir, "--question", "paid orders", "--dimensions", "32"]),
    ).toBe(1);
    expect(stderr.join("")).toMatch(/built with embedder "mock:lexical-64" but this query uses "mock:lexical-32"/);
  });

  it("query --store memory explains the store is per-process", async () => {
    const schemaDir = copyFixture();
    expect(
      await runRagCli(["query", schemaDir, "--store", "memory", "--question", "x"]),
    ).toBe(1);
    expect(stderr.join("")).toMatch(/memory store lives only inside one process/);
  });

  it("index --force re-embeds everything", async () => {
    const schemaDir = copyFixture();
    expect(await runRagCli(["index", schemaDir])).toBe(0);
    stdout = [];
    expect(await runRagCli(["index", schemaDir])).toBe(0);
    expect(JSON.parse(stdout.join(""))).toMatchObject({ chunksIndexed: 0 });
    stdout = [];
    expect(await runRagCli(["index", schemaDir, "--force"])).toBe(0);
    const forced = JSON.parse(stdout.join("")) as { chunksIndexed: number; chunksTotal: number };
    expect(forced.chunksIndexed).toBe(forced.chunksTotal);
  });

  it("rejects a non-positive --dimensions", async () => {
    const schemaDir = copyFixture();
    expect(await runRagCli(["index", schemaDir, "--dimensions", "0"])).toBe(1);
    expect(stderr.join("")).toMatch(/--dimensions must be a positive integer/);
  });
});
