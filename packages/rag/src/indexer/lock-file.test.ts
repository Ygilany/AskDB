import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
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

  it("distinguishes missing and invalid lock files", () => {
    const path = tempPath();
    expect(inspectLockFile(path)).toEqual({ status: "missing" });
    writeFileSync(path, "{not json");
    expect(inspectLockFile(path)).toEqual({ status: "invalid" });
  });
});
