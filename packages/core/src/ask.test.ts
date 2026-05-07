import type { LanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";
import { ask } from "./ask.js";
import { AskDbLogEvent } from "./logging/log-events.js";
import type { NormalizedSchema } from "./schema/types.js";

const minimalSchema: NormalizedSchema = {
  tables: [{ name: "users", columns: [{ name: "id", type: "integer", nullable: false, primaryKey: true }] }],
};

const fakeModel = {} as LanguageModel;

describe("ask (mode + logging)", () => {
  it("emits pipeline mode before generation and does not post_execute without execute", async () => {
    const info = vi.fn();
    await ask({
      question: "count users",
      schema: minimalSchema,
      model: fakeModel,
      execute: false,
      mode: "bounded_results",
      logger: { info, error: vi.fn() },
      deps: {
        generateText: vi.fn(async () => ({
          text: "```sql\nSELECT COUNT(*) AS n FROM users\n```",
        })),
      },
    });

    const modes = info.mock.calls.filter((c) => (c[0] as { event?: string })?.event === AskDbLogEvent.PipelineMode);
    expect(modes.length).toBeGreaterThanOrEqual(1);
    expect(modes[0]![0]).toMatchObject({ mode: "bounded_results" });

    const post = info.mock.calls.filter(
      (c) => (c[0] as { event?: string })?.event === AskDbLogEvent.PipelinePostExecute,
    );
    expect(post).toHaveLength(0);
  });
});
