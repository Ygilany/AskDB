import { describe, expect, it, vi, beforeEach } from "vitest";
import { AskDbError } from "@askdb/core";

// Mock `pg` so we can simulate "peer dep missing" without uninstalling the workspace dev dep.
// `vi.hoisted` is required because `vi.mock` is hoisted to the top of the file before imports.
const pgState = vi.hoisted(() => ({ shouldFail: false }));
vi.mock("pg", async () => {
  if (pgState.shouldFail) {
    throw new Error("Cannot find module 'pg'");
  }
  return await vi.importActual<typeof import("pg")>("pg");
});

describe("exec/postgres — lazy `pg` peer dependency", () => {
  beforeEach(async () => {
    pgState.shouldFail = false;
    const { __resetPgModuleCacheForTests } = await import("./postgres.js");
    __resetPgModuleCacheForTests();
  });

  it("createPostgresCatalogQueryRunner() does not load `pg` at construction time", async () => {
    const { createPostgresCatalogQueryRunner } = await import("./postgres.js");
    pgState.shouldFail = true;

    expect(() => createPostgresCatalogQueryRunner("postgres://nowhere")).not.toThrow();
  });

  it("invoking the runner when `pg` is missing rejects with a helpful AskDbError", async () => {
    const { createPostgresCatalogQueryRunner, __resetPgModuleCacheForTests } = await import("./postgres.js");
    __resetPgModuleCacheForTests();
    pgState.shouldFail = true;
    const runner = createPostgresCatalogQueryRunner("postgres://nowhere");

    const err = await runner("SELECT 1").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AskDbError);
    const msg = (err as AskDbError).message;
    expect(msg).toMatch(/optional `pg` peer dependency/);
    expect(msg).toMatch(/`pnpm add pg`/);
    expect(msg).toMatch(/catalog query runner/);
  });

  it("after a missing-pg failure, a later invocation retries the import (cache cleared)", async () => {
    const { createPostgresCatalogQueryRunner, __resetPgModuleCacheForTests } = await import("./postgres.js");
    __resetPgModuleCacheForTests();
    pgState.shouldFail = true;
    const runner = createPostgresCatalogQueryRunner("postgres://nowhere");

    await expect(runner("SELECT 1")).rejects.toBeInstanceOf(AskDbError);

    // Simulate the consumer running `pnpm add pg` and trying again — the cache must not pin the
    // failure or we'd force them to restart the process.
    pgState.shouldFail = false;
    // We don't actually want to hit a real DB here, so just assert the import resolves past the
    // missing-peer guard. The follow-on `Pool` connect will fail with a non-AskDbError, which is
    // exactly the signal we want — pg loaded, runner proceeded.
    const second = await runner("SELECT 1").catch((e: unknown) => e);
    expect(second).not.toBeInstanceOf(AskDbError);
  });
});
