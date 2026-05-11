import type { LanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";
import { ask, type AskDialect } from "./ask.js";
import { AskDbError } from "./errors.js";
import type { AskDbExecutor } from "./exec/executor.js";
import type { TabularResult } from "./exec/types.js";
import { AskDbLogEvent } from "./logging/log-events.js";
import type { NormalizedSchema } from "./schema/types.js";

const minimalSchema: NormalizedSchema = {
  tables: [
    { name: "users", columns: [{ name: "id", type: "integer", nullable: false, primaryKey: true }] },
  ],
};

const fakeModel = {} as LanguageModel;

const cannedSql = "SELECT 1 AS n";
const fakeDialect: AskDialect = {
  generate: async () => ({ sql: cannedSql }),
};

function makeLogger() {
  return { info: vi.fn(), error: vi.fn() };
}

function eventNames(calls: ReadonlyArray<readonly unknown[]>): string[] {
  return calls.map((c) => (c[0] as { event?: string })?.event ?? "");
}

describe("ask — executor seam", () => {
  it("uses the supplied executor and returns its TabularResult unchanged", async () => {
    const canned: TabularResult = { columns: ["x"], rows: [[1]] };
    const executor = vi.fn<AskDbExecutor>(async () => canned);
    const logger = makeLogger();

    const out = await ask({
      question: "anything",
      schema: minimalSchema,
      model: fakeModel,
      dialect: fakeDialect,
      execute: true,
      executor,
      logger,
    });

    expect(out.sql).toBe(cannedSql);
    expect(out.result).toBe(canned);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor).toHaveBeenCalledWith(cannedSql);

    const events = eventNames(logger.info.mock.calls);
    expect(events).toContain(AskDbLogEvent.PipelineExecuteStart);
    expect(events).toContain(AskDbLogEvent.PipelineExecuteComplete);
  });

  it("throws AskDbError with execute=true and no executor provided", async () => {
    await expect(
      ask({
        question: "anything",
        schema: minimalSchema,
        model: fakeModel,
        dialect: fakeDialect,
        execute: true,
      }),
    ).rejects.toBeInstanceOf(AskDbError);
  });

  it("when the executor throws, pipeline emits askdb.pipeline.failed{phase:'execute'} and rethrows", async () => {
    const boom = new Error("driver exploded");
    const executor: AskDbExecutor = async () => {
      throw boom;
    };
    const logger = makeLogger();

    await expect(
      ask({
        question: "anything",
        schema: minimalSchema,
        model: fakeModel,
        dialect: fakeDialect,
        execute: true,
        executor,
        logger,
      }),
    ).rejects.toBe(boom);

    const failed = logger.error.mock.calls.find(
      (c) => (c[0] as { event?: string })?.event === AskDbLogEvent.PipelineFailed,
    );
    expect(failed).toBeDefined();
    expect(failed![0]).toMatchObject({
      event: AskDbLogEvent.PipelineFailed,
      phase: "execute",
      errMessage: "driver exploded",
    });
  });

  it("execute=false still ignores the executor (no execution attempted)", async () => {
    const executor = vi.fn<AskDbExecutor>(async () => ({ columns: [], rows: [] }));

    const out = await ask({
      question: "anything",
      schema: minimalSchema,
      model: fakeModel,
      dialect: fakeDialect,
      execute: false,
      executor,
    });

    expect(out.result).toBeUndefined();
    expect(executor).not.toHaveBeenCalled();
  });
});
