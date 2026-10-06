import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPgvectorStore } from "./pgvector.js";

// `pg` as it looks to `@askdb/rag` when the host hasn't installed it where
// the package can see it (e.g. running from an npx cache).
vi.mock("pg", () => {
  throw new Error("Cannot find package 'pg'");
});

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/**
 * A project directory holding a fake `pg` whose `Pool.query` rejects with
 * `marker`. (Vitest's own interop hands named exports through for a
 * default-only module, so the CommonJS `default` unwrap is covered by
 * `pnpm smoke:install`, against the real `pg` under plain Node.)
 */
function projectWithFakePg(marker: string): string {
  const dir = mkdtempSync(join(tmpdir(), "askdb-rag-pg-"));
  dirs.push(dir);
  const pkg = join(dir, "node_modules", "pg");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "pg", type: "module", main: "index.js" }));
  const pool = `class Pool { async query() { throw new Error(${JSON.stringify(marker)}); } async end() {} }`;
  writeFileSync(join(pkg, "index.js"), `export ${pool}\n`);
  return dir;
}

describe("createPgvectorStore loading the optional pg peer", () => {
  it("falls back to resolving pg from resolveFrom", async () => {
    const store = createPgvectorStore({
      connectionString: "postgres://localhost/none",
      resolveFrom: projectWithFakePg("fake pg from resolveFrom"),
    });
    await expect(store.count()).rejects.toThrow("fake pg from resolveFrom");
  });


  it("gives an install hint when neither @askdb/rag nor resolveFrom can resolve pg", async () => {
    // A `pg` whose entry file is missing fails to resolve here, before any
    // NODE_PATH fallback (which pnpm sets for this test run) is tried.
    const dir = mkdtempSync(join(tmpdir(), "askdb-rag-nopg-"));
    dirs.push(dir);
    mkdirSync(join(dir, "node_modules", "pg"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "pg", "package.json"), JSON.stringify({ name: "pg", main: "missing.js" }));
    const store = createPgvectorStore({ connectionString: "postgres://localhost/none", resolveFrom: dir });
    await expect(store.count()).rejects.toThrow(/requires the optional `pg` peer dependency/);
  });
});
