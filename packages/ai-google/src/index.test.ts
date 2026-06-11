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

  it("resolves Google config with the Gemini language default", () => {
    expect(
      googleProvider.resolveConfig(
        { GOOGLE_GENERATIVE_AI_API_KEY: "goog-key" },
        { usage: "language" },
      ),
    ).toEqual({
      provider: "google",
      apiKey: "goog-key",
      model: "gemini-2.0-flash",
    });
  });

  it("uses GOOGLE_AI_API_KEY and GOOGLE_AI_MODEL aliases", () => {
    expect(
      googleProvider.resolveConfig(
        {
          GOOGLE_AI_API_KEY: "goog-alias",
          GOOGLE_AI_MODEL: "gemini-1.5-pro",
        },
        { usage: "language" },
      ),
    ).toEqual({
      provider: "google",
      apiKey: "goog-alias",
      model: "gemini-1.5-pro",
    });
  });

  it("prefers ASKDB_AI_API_KEY and GOOGLE_AI_BASE_URL", () => {
    expect(
      googleProvider.resolveConfig(
        {
          ASKDB_AI_API_KEY: "universal",
          GOOGLE_GENERATIVE_AI_API_KEY: "goog-native",
          GOOGLE_AI_BASE_URL: "https://custom.google.endpoint/v1",
        },
        { usage: "language" },
      ),
    ).toEqual({
      provider: "google",
      apiKey: "universal",
      model: "gemini-2.0-flash",
      baseURL: "https://custom.google.endpoint/v1",
    });
  });

  it("does not use OPENAI_API_KEY_SECONDARY as a Google fallback", () => {
    expect(
      googleProvider.resolveConfig(
        { OPENAI_API_KEY_SECONDARY: "openai-secondary" },
        { usage: "language" },
      ),
    ).toBeUndefined();
  });

  it("throws when no Google embedding model is configured", () => {
    expect(() =>
      googleProvider.resolveConfig(
        { GOOGLE_GENERATIVE_AI_API_KEY: "goog-key" },
        { usage: "embedding" },
      ),
    ).toThrowError(
      "google: no embedding model configured. Set ASKDB_AI_MODEL (or the provider's native model variable).",
    );
  });

  it("resolves Google embedding model env vars", () => {
    expect(
      googleProvider.resolveConfig(
        {
          GOOGLE_GENERATIVE_AI_API_KEY: "goog-key",
          GOOGLE_AI_EMBEDDING_MODEL: "text-embedding-004",
        },
        { usage: "embedding" },
      ),
    ).toEqual({
      provider: "google",
      apiKey: "goog-key",
      model: "text-embedding-004",
    });
  });
});
