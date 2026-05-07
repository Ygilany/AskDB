import { describe, expect, it, vi } from "vitest";
import { AskDbLogEvent } from "../logging/log-events.js";
import { logPostExecuteModeBranch } from "./post-execute-log.js";

describe("logPostExecuteModeBranch", () => {
  it("schema_only logs skipped branch", () => {
    const info = vi.fn();
    logPostExecuteModeBranch({ info, error: vi.fn() }, "schema_only", 3);
    expect(info).toHaveBeenCalledOnce();
    expect(info.mock.calls[0]![0]).toMatchObject({
      event: AskDbLogEvent.PipelinePostExecute,
      mode: "schema_only",
      branch: "skipped",
      rowCount: 3,
    });
  });

  it("bounded_results logs stub branch", () => {
    const info = vi.fn();
    logPostExecuteModeBranch({ info, error: vi.fn() }, "bounded_results", 10);
    expect(info.mock.calls[0]![0]).toMatchObject({
      event: AskDbLogEvent.PipelinePostExecute,
      mode: "bounded_results",
      branch: "stub",
      rowCount: 10,
    });
  });

  it("no-ops when logger is undefined", () => {
    expect(() => logPostExecuteModeBranch(undefined, "schema_only", 0)).not.toThrow();
  });
});
