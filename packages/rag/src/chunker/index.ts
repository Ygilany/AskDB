export { chunkSchema, type ChunkResult, type ChunkStats } from "./chunker.js";
export {
  loadChunkerSourcesFromDir,
  loadChunkerSourcesFromBundleJson,
  type ChunkerSources,
} from "./sources.js";
export {
  DEFAULT_CHUNK_MAX_CHARS,
  type ChunkOptions,
} from "./options.js";

import { chunkSchema, type ChunkResult } from "./chunker.js";
import {
  loadChunkerSourcesFromDir,
  loadChunkerSourcesFromBundleJson,
} from "./sources.js";
import type { ChunkOptions } from "./options.js";

/** Convenience: load + chunk a v2 directory in one call. */
export function chunkSchemaDir(dir: string, options?: ChunkOptions): ChunkResult {
  return chunkSchema(loadChunkerSourcesFromDir(dir), options);
}

/** Convenience: load + chunk a v2 bundle JSON string in one call. */
export function chunkSchemaBundle(raw: string, options?: ChunkOptions): ChunkResult {
  return chunkSchema(loadChunkerSourcesFromBundleJson(raw), options);
}
