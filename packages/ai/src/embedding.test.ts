import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  return {
    defaultEmbeddingSettingsMiddleware: vi.fn((settings: unknown) => ({
      kind: "middleware",
      settings,
    })),
    wrapEmbeddingModel: vi.fn((options: unknown) => ({
      kind: "wrapped",
      options,
    })),
  };
});

vi.mock("ai", () => ({
  defaultEmbeddingSettingsMiddleware: mocks.defaultEmbeddingSettingsMiddleware,
  wrapEmbeddingModel: mocks.wrapEmbeddingModel,
}));

import { withEmbeddingProviderOptions } from "./embedding.js";

const baseModel = { kind: "embedding", model: "test-model" } as unknown as import("ai").EmbeddingModel;

describe("withEmbeddingProviderOptions", () => {
  it("returns the model unchanged when no options are set", () => {
    const result = withEmbeddingProviderOptions(baseModel, "myKey", {});
    expect(result).toBe(baseModel);
    expect(mocks.wrapEmbeddingModel).not.toHaveBeenCalled();
  });

  it("returns the model unchanged when called with no options argument", () => {
    const result = withEmbeddingProviderOptions(baseModel, "myKey");
    expect(result).toBe(baseModel);
    expect(mocks.wrapEmbeddingModel).not.toHaveBeenCalled();
  });

  it("wraps the model with both dimensions and user", () => {
    const result = withEmbeddingProviderOptions(baseModel, "myKey", {
      dimensions: 512,
      user: "u",
    });
    expect(result).toEqual({
      kind: "wrapped",
      options: {
        model: baseModel,
        middleware: {
          kind: "middleware",
          settings: {
            settings: {
              providerOptions: {
                myKey: { dimensions: 512, user: "u" },
              },
            },
          },
        },
      },
    });
  });

  it("wraps the model with only dimensions", () => {
    const result = withEmbeddingProviderOptions(baseModel, "myKey", {
      dimensions: 256,
    });
    expect(result).toEqual({
      kind: "wrapped",
      options: {
        model: baseModel,
        middleware: {
          kind: "middleware",
          settings: {
            settings: {
              providerOptions: {
                myKey: { dimensions: 256 },
              },
            },
          },
        },
      },
    });
  });

  it("wraps the model with only user", () => {
    const result = withEmbeddingProviderOptions(baseModel, "providerX", {
      user: "alice",
    });
    expect(result).toEqual({
      kind: "wrapped",
      options: {
        model: baseModel,
        middleware: {
          kind: "middleware",
          settings: {
            settings: {
              providerOptions: {
                providerX: { user: "alice" },
              },
            },
          },
        },
      },
    });
  });

  it("maps options to a provider's own setting names and drops the ones it leaves undefined", () => {
    // Gemini calls the size `outputDimensionality` and has no per-end-user field.
    const result = withEmbeddingProviderOptions(
      baseModel,
      "google",
      { dimensions: 768, user: "alice" },
      ({ dimensions }) => ({ outputDimensionality: dimensions }),
    );
    expect(result).toEqual({
      kind: "wrapped",
      options: {
        model: baseModel,
        middleware: {
          kind: "middleware",
          settings: {
            settings: {
              providerOptions: {
                google: { outputDimensionality: 768 },
              },
            },
          },
        },
      },
    });
  });

  it("returns the model unchanged when the mapper yields no settings", () => {
    const result = withEmbeddingProviderOptions(
      baseModel,
      "google",
      { user: "alice" },
      ({ dimensions }) => ({ outputDimensionality: dimensions }),
    );
    expect(result).toBe(baseModel);
  });
});
