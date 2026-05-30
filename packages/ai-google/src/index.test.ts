import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const google = vi.fn((model: string) => ({ kind: "language", model }));
  Object.assign(google, {
    textEmbeddingModel: vi.fn((model: string) => ({
      kind: "embedding",
      model,
    })),
  });

  return {
    createGoogleGenerativeAI: vi.fn(() => google),
    google,
  };
});

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: mocks.createGoogleGenerativeAI,
}));

import { googleProvider } from "./index";

describe("googleProvider", () => {
  beforeEach(() => {
    mocks.createGoogleGenerativeAI.mockClear();
    mocks.google.mockClear();
    mocks.google.textEmbeddingModel.mockClear();
  });

  it("creates language and embedding models from AskDB config", () => {
    expect(googleProvider.provider).toBe("google");

    const languageModel = googleProvider.createLanguageModel({
      provider: "google",
      apiKey: "test-key",
      baseURL: "https://generativelanguage.googleapis.com",
      model: "gemini-1.5-flash",
    });
    const embeddingModel = googleProvider.createEmbeddingModel({
      provider: "google",
      apiKey: "test-key",
      model: "text-embedding-004",
    });

    expect(languageModel).toEqual({ kind: "language", model: "gemini-1.5-flash" });
    expect(embeddingModel).toEqual({ kind: "embedding", model: "text-embedding-004" });
    expect(mocks.createGoogleGenerativeAI).toHaveBeenNthCalledWith(1, {
      apiKey: "test-key",
      baseURL: "https://generativelanguage.googleapis.com",
    });
    expect(mocks.createGoogleGenerativeAI).toHaveBeenNthCalledWith(2, {
      apiKey: "test-key",
    });
  });
});
