/**
 * `@askdb/config` must not depend on `@askdb/ai` (config is the zero-AI
 * bootstrap layer every surface loads), so it keeps its own provider list and
 * default models. This test is the anti-drift guard: it fails when the two
 * disagree, so adding a built-in provider here forces the matching
 * `askdb.config.*` branch there (and vice versa).
 */
import {
  ASKDB_AI_PROVIDERS,
  DEFAULT_ANTHROPIC_CHAT_MODEL,
  DEFAULT_AZURE_OPENAI_DEPLOYMENT,
  DEFAULT_GATEWAY_CHAT_MODEL,
  DEFAULT_GOOGLE_CHAT_MODEL,
  DEFAULT_OPENAI_CHAT_MODEL,
} from "@askdb/config";
import { describe, expect, it } from "vitest";
import { BUILTIN_AI_PROVIDERS, findBuiltinAiProvider } from "./index.js";

describe("@askdb/config stays aligned with the built-in provider table", () => {
  it("ASKDB_AI_PROVIDERS lists every built-in provider plus the aliases config has a branch for", () => {
    const configIds = new Set<string>(ASKDB_AI_PROVIDERS);
    for (const row of BUILTIN_AI_PROVIDERS) {
      expect(configIds.has(row.provider), `config is missing "${row.provider}"`).toBe(true);
    }
    for (const id of ASKDB_AI_PROVIDERS) {
      expect(findBuiltinAiProvider(id), `config lists "${id}", which is not built in`).toBeDefined();
    }
  });

  it("config's default chat models match the built-in defaults", () => {
    const defaults: Record<string, string> = {
      openai: DEFAULT_OPENAI_CHAT_MODEL,
      anthropic: DEFAULT_ANTHROPIC_CHAT_MODEL,
      google: DEFAULT_GOOGLE_CHAT_MODEL,
      azure: DEFAULT_AZURE_OPENAI_DEPLOYMENT,
      gateway: DEFAULT_GATEWAY_CHAT_MODEL,
    };
    for (const row of BUILTIN_AI_PROVIDERS) {
      expect(defaults[row.provider], row.provider).toBe(row.env.defaultModel);
    }
  });
});
