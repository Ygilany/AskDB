import type { LanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";
import { ask } from "./ask.js";
import { AskDbError } from "./errors.js";
import type { AskDbExecutor } from "./exec/executor.js";
import type { TabularResult } from "./exec/postgres.js";
import { AskDbLogEvent } from "./logging/log-events.js";
import type { NormalizedSchema } from "./schema/types.js";

const minimalSchema: NormalizedSchema = {
  tables: [
    { name: "users", columns: [{ name: "id", type: "integer", nullable: false, primaryKey: true }] },
  ],
};

const fakeModel = {} as LanguageModel;

const cannedSelect = "```sql\nSELECT 1 AS n\n```";
const stubGenerateText = vi.fn(async () => ({ text: cannedSelect }));

function makeLogger() {
  return { info: vi.fn(), error: vi.fn() };
}

function eventNames(calls: ReadonlyArray<readonly unknown[]>): string[] {
  return calls.map((c) => (c[0] as { event?: string })?.event ?? "");
}

describe("ask — executor seam (Phase 4 Group 1)", () => {
  it("uses the supplied executor and returns its TabularResult unchanged", async () => {
    const canned: TabularResult = { columns: ["x"], rows: [[1]] };
    const executor = vi.fn<AskDbExecutor>(async () => canned);
    const logger = makeLogger();

    const out = await ask({
      question: "anything",
      schema: minimalSchema,
      model: fakeModel,
      execute: true,
      executor,
      logger,
      deps: { generateText: stubGenerateText as never },
    });

    expect(out.sql).toBe("SELECT 1 AS n");
    expect(out.result).toBe(canned);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor).toHaveBeenCalledWith("SELECT 1 AS n");

    const events = eventNames(logger.info.mock.calls);
    expect(events).toContain(AskDbLogEvent.PipelineExecuteStart);
    expect(events).toContain(AskDbLogEvent.PipelineExecuteComplete);
    // Custom executor path must not emit the precedence-warning event.
    expect(events).not.toContain(AskDbLogEvent.ConfigExecutorOverridesConnectionString);
  });

  it("when both `executor` and `connectionString` are passed, executor wins and the override event fires before generation", async () => {
    const canned: TabularResult = { columns: ["x"], rows: [] };
    const executor = vi.fn<AskDbExecutor>(async () => canned);
    const logger = makeLogger();

    await ask({
      question: "anything",
      schema: minimalSchema,
      model: fakeModel,
      execute: true,
      executor,
      connectionString: "postgres://should-be-ignored",
      logger,
      deps: { generateText: stubGenerateText as never },
    });

    expect(executor).toHaveBeenCalledTimes(1);

    const events = eventNames(logger.info.mock.calls);
    const overrideIdx = events.indexOf(AskDbLogEvent.ConfigExecutorOverridesConnectionString);
    const generateStartIdx = events.indexOf(AskDbLogEvent.PipelineGenerateStart);
    expect(overrideIdx).toBeGreaterThanOrEqual(0);
    expect(generateStartIdx).toBeGreaterThanOrEqual(0);
    expect(overrideIdx).toBeLessThan(generateStartIdx);

    const overrideCall = logger.info.mock.calls[overrideIdx]![0] as Record<string, unknown>;
    expect(overrideCall).toMatchObject({
      event: AskDbLogEvent.ConfigExecutorOverridesConnectionString,
      chosen: "executor",
    });
  });

  it("throws AskDbError with execute=true and neither executor nor connectionString", async () => {
    await expect(
      ask({
        question: "anything",
        schema: minimalSchema,
        model: fakeModel,
        execute: true,
        deps: { generateText: stubGenerateText as never },
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
        execute: true,
        executor,
        logger,
        deps: { generateText: stubGenerateText as never },
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
      execute: false,
      executor,
      deps: { generateText: stubGenerateText as never },
    });

    expect(out.result).toBeUndefined();
    expect(executor).not.toHaveBeenCalled();
  });
});
