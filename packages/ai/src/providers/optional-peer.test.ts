import { describe, expect, it } from "vitest";
import { rethrowMissingPeer } from "./optional-peer.js";

function moduleNotFound(message: string, code = "ERR_MODULE_NOT_FOUND"): Error {
  return Object.assign(new Error(message), { code });
}

describe("rethrowMissingPeer", () => {
  it("passes the loaded module through when the peer is installed", async () => {
    const mod = { createThing: () => "ok" };
    await expect(Promise.resolve(mod).catch(rethrowMissingPeer("google", "@ai-sdk/google"))).resolves.toBe(mod);
  });

  it("rethrows a missing peer (ESM) as an actionable install message", async () => {
    const cause = moduleNotFound(
      "Cannot find package '@ai-sdk/google' imported from /app/node_modules/@askdb/ai/dist/providers/google.js",
    );
    const error = await Promise.reject(cause)
      .catch(rethrowMissingPeer("google", "@ai-sdk/google"))
      .catch((e: unknown) => e as Error);
    expect(error.message).toBe(
      "Provider 'google' requires the optional peer dependency @ai-sdk/google. Install it: npm i @ai-sdk/google",
    );
    expect(error.cause).toBe(cause);
  });

  it("recognizes the CommonJS MODULE_NOT_FOUND shape", async () => {
    const cause = moduleNotFound("Cannot find module '@ai-sdk/openai'", "MODULE_NOT_FOUND");
    await expect(Promise.reject(cause).catch(rethrowMissingPeer("openai", "@ai-sdk/openai"))).rejects.toThrow(
      "Provider 'openai' requires the optional peer dependency @ai-sdk/openai. Install it: npm i @ai-sdk/openai",
    );
  });

  it("does not blame the peer when one of the peer's own dependencies is missing", async () => {
    const cause = moduleNotFound(
      "Cannot find package '@ai-sdk/provider-utils' imported from /app/node_modules/@ai-sdk/google/dist/index.mjs",
    );
    await expect(Promise.reject(cause).catch(rethrowMissingPeer("google", "@ai-sdk/google"))).rejects.toBe(cause);
  });

  it("rethrows unrelated failures unchanged", async () => {
    const cause = new Error("boom");
    await expect(Promise.reject(cause).catch(rethrowMissingPeer("google", "@ai-sdk/google"))).rejects.toBe(cause);
  });
});
