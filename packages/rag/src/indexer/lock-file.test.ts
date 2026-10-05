import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkIndexMatches,
  inspectLockFile,
  readLockFile,
  writeLockFile,
  type SchemaLockFile,
} from "./lock-file.js";

const tempDirs: string[] = [];

function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "askdb-rag-lock-"));
  tempDirs.push(dir);
  return join(dir, "schema.lock.json");
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("schema.lock.json", () => {
  it("round-trips with deterministic hash key ordering", () => {
    const path = tempPath();
    const lock: SchemaLockFile = {
      version: 2,
      dimensions: 2,
      store: { kind: "file", location: "/tmp/schema" },
      schemaId: "orders-users",
      embedderId: "test:lock",
      hashes: {
        "chunk:orders-users:z": "z-hash",
        "chunk:orders-users:a": "a-hash",
      },
      updatedAt: "2026-05-10T00:00:00.000Z",
    };

    writeLockFile(path, lock);
    const first = readLockFile(path);
    expect(first).toEqual({
      ...lock,
      hashes: {
        "chunk:orders-users:a": "a-hash",
        "chunk:orders-users:z": "z-hash",
      },
    });

    writeLockFile(path, first!);
    expect(readLockFile(path)).toEqual(first);
  });

  it("reports older-format locks as outdated (and readLockFile ignores them)", () => {
    const path = tempPath();
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        schemaId: "orders-users",
        hashes: { "chunk:table:public.orders": "h" },
      }),
    );
    expect(readLockFile(path)).toBeUndefined();
    expect(inspectLockFile(path)).toEqual({
      status: "outdated",
      version: 1,
      schemaId: "orders-users",
      hashes: { "chunk:table:public.orders": "h" },
    });
  });

  it("treats a lock from a newer version as invalid, not outdated", () => {
    const path = tempPath();
    writeFileSync(path, JSON.stringify({ version: 3, schemaId: "orders-users", hashes: { "chunk:x": "h" } }));
    expect(inspectLockFile(path)).toEqual({ status: "invalid" });
  });

  it("distinguishes missing and invalid lock files", () => {
    const path = tempPath();
    expect(inspectLockFile(path)).toEqual({ status: "missing" });
    writeFileSync(path, "{not json");
    expect(inspectLockFile(path)).toEqual({ status: "invalid" });
  });

  describe("checkIndexMatches", () => {
    function lockWith(fields: Partial<SchemaLockFile>): string {
      const path = tempPath();
      writeFileSync(
        path,
        JSON.stringify({ version: 2, schemaId: "s", embedderId: "e", dimensions: 3, hashes: {}, ...fields }),
      );
      return path;
    }

    it.each<[string, () => string, { embedderId?: string; dimensions?: number }, string | undefined]>([
      ["matches", () => lockWith({}), { embedderId: "e", dimensions: 3 }, undefined],
      ["ignores a width the caller doesn't know", () => lockWith({}), { embedderId: "e" }, undefined],
      ["passes when there's no lock", () => tempPath(), { embedderId: "e" }, undefined],
      ["passes a lock for another schema", () => lockWith({ schemaId: "other" }), { embedderId: "x" }, undefined],
      ["refuses another embedder", () => lockWith({}), { embedderId: "f", dimensions: 3 }, "embedder-changed"],
      ["refuses a lock with no embedder id", () => lockWith({ embedderId: undefined }), { embedderId: "e" }, "embedder-changed"],
      ["refuses no embedder id against a lock with one", () => lockWith({}), {}, "embedder-changed"],
      ["matches no embedder id against a lock without one, as the indexer does", () => lockWith({ embedderId: undefined }), {}, undefined],
      ["refuses a lock an interrupted embedder switch left incomplete", () => lockWith({ incomplete: true }), { embedderId: "e" }, "index-incomplete"],
      [
        "passes an older-format lock for another schema",
        () => {
          const path = tempPath();
          writeFileSync(path, JSON.stringify({ version: 1, schemaId: "other", hashes: {} }));
          return path;
        },
        { embedderId: "e" },
        undefined,
      ],
      ["refuses another width", () => lockWith({}), { embedderId: "e", dimensions: 4 }, "dimensions-changed"],
      [
        "refuses an older-format lock",
        () => {
          const path = tempPath();
          writeFileSync(path, JSON.stringify({ version: 1, schemaId: "s", hashes: {} }));
          return path;
        },
        { embedderId: "e" },
        "lock-outdated",
      ],
    ])("%s", (_case, lockFilePath, query, reason) => {
      const match = checkIndexMatches({ lockFilePath: lockFilePath(), schemaId: "s", ...query, embedderId: query.embedderId });
      expect(match.ok ? undefined : match.reason).toBe(reason);
    });
  });
});
