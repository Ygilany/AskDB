import { describe, expect, it } from "vitest";
import type { Embedder } from "../types.js";
import { detectEmbeddingDimensions } from "./dimensions.js";

describe("detectEmbeddingDimensions", () => {
  it("returns the width of the vector the embedder returns for one text, in one call", async () => {
    const calls: string[][] = [];
    const embedder: Embedder = async (texts) => {
      calls.push(texts);
      return texts.map(() => [0.1, 0.2, 0.3]);
    };

    await expect(detectEmbeddingDimensions(embedder)).resolves.toBe(3);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(1);
  });

  it.each<[string, number[][]]>([
    ["no vector", []],
    ["an empty vector", [[]]],
    ["two vectors for one text", [[1], [2]]],
  ])("refuses an embedder that returns %s", async (_case, vectors) => {
    await expect(detectEmbeddingDimensions(async () => vectors)).rejects.toThrow(
      /detectEmbeddingDimensions: expected one non-empty vector for one text/,
    );
  });
});
