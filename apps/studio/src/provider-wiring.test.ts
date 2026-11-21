import { BUILTIN_AI_PROVIDERS } from "@askdb/ai";
import { describe, expect, it } from "vitest";
import { PROVIDER_WIRING, PROVIDER_WIRING_ALIASES, providerWiring } from "./web/lib/provider-wiring.js";

// The Playground's "Get the code" snippet names the SDK package to install and import. The
// browser bundle keeps its own table, so a built-in provider added to `@askdb/ai` without an
// entry here used to get the OpenAI snippet.
describe("Studio 'Get the code' provider wiring", () => {
  const ids = BUILTIN_AI_PROVIDERS.flatMap((row) => [row.provider, ...row.aliases].map((id) => ({ id, row })));

  it.each(ids)("$id installs the SDK package @askdb/ai loads for it", ({ id, row }) => {
    // A provider with no peer package ships inside `ai` itself.
    expect(providerWiring(id)?.sdkPackage).toBe(row.peerPackage ?? "ai");
  });

  it("has no entry or alias for a provider that is not built in", () => {
    const canonical = BUILTIN_AI_PROVIDERS.map((row) => row.provider);
    expect(Object.keys(PROVIDER_WIRING).sort()).toEqual([...canonical].sort());
    for (const [alias, target] of Object.entries(PROVIDER_WIRING_ALIASES)) {
      expect(BUILTIN_AI_PROVIDERS.find((row) => row.provider === target)?.aliases).toContain(alias);
    }
  });

  it("gives no wiring for an unknown provider, instead of another provider's", () => {
    expect(providerWiring("mistral")).toBeUndefined();
    expect(providerWiring("toString")).toBeUndefined();
  });
});
