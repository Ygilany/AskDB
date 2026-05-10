import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLockFile, writeLockFile, type SchemaLockFile } from "./lock-file.js";

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
      version: 1,
      schemaId: "orders-users",
      embedderId: "test:lock",
      hashes: {
        "chunk:z": "z-hash",
        "chunk:a": "a-hash",
      },
      updatedAt: "2026-05-10T00:00:00.000Z",
    };

    writeLockFile(path, lock);
    const first = readLockFile(path);
    expect(first).toEqual({
      ...lock,
      hashes: {
        "chunk:a": "a-hash",
        "chunk:z": "z-hash",
      },
    });

    writeLockFile(path, first!);
    expect(readLockFile(path)).toEqual(first);
  });
});
