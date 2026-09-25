import { listBuiltinAiProviderSetups } from "@askdb/ai";
import { ASKDB_AI_PROVIDERS } from "@askdb/config";
import { describe, expect, it } from "vitest";
import { AI_PROVIDERS } from "./web/views/setup/types.js";

describe("Studio setup wizard AI providers", () => {
  it("match @askdb/ai's built-in provider table (the browser bundle keeps its own copy)", () => {
    expect(AI_PROVIDERS).toEqual(
      listBuiltinAiProviderSetups(ASKDB_AI_PROVIDERS).map(({ id, label, keyEnv, modelEnv }) => ({
        value: id,
        label,
        keyEnv,
        modelEnv,
      })),
    );
  });
});
