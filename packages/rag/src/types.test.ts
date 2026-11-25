import { describe, expect, it } from "vitest";
import { CHUNK_TYPES, isChunkType } from "./index.js";
import type { ChunkType } from "./types.js";

// `ChunkType` is derived from `CHUNK_TYPES`, so the list is the single source
// of truth — a new chunk type is available to every consumer at once (#1064).
describe("CHUNK_TYPES / isChunkType", () => {
  it("lists every chunk type", () => {
    expect([...CHUNK_TYPES]).toEqual([
      "table",
      "column",
      "cql",
      "question",
      "concept",
      "relationship",
      "tenant-policy",
    ]);
    // `ChunkType` is derived from this tuple, so the list and the type can't
    // drift — but a member dropped here still shrinks the public API, so pin
    // the count.
    const everyType: ChunkType[] = [...CHUNK_TYPES];
    expect(everyType).toHaveLength(7);
  });

  it("accepts every listed type and rejects anything else", () => {
    for (const type of CHUNK_TYPES) expect(isChunkType(type)).toBe(true);
    for (const value of ["", "tables", "TABLE", "tenant_policy", "tenant-policy "]) {
      expect(isChunkType(value)).toBe(false);
    }
  });
});
