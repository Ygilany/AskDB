import { AskDbError } from "../errors.js";

/** Operating modes selectable in Phase 2 v1 (see `docs/contracts/modes-v1.md`). */
export const ASKDB_MODES_V1 = ["schema_only", "bounded_results"] as const;
export type AskDbModeV1 = (typeof ASKDB_MODES_V1)[number];

const MODE_SET = new Set<string>(ASKDB_MODES_V1);

/** Default mode when unset — strictest trust boundary. */
export const DEFAULT_ASKDB_MODE: AskDbModeV1 = "schema_only";

export function parseAskDbModeV1(raw: string | undefined): AskDbModeV1 {
  if (raw === undefined || raw === "") {
    return DEFAULT_ASKDB_MODE;
  }
  const n = raw.trim().toLowerCase().replace(/-/g, "_");
  if (!MODE_SET.has(n)) {
    throw new AskDbError(
      `Invalid mode: ${JSON.stringify(raw)}. Expected one of: ${ASKDB_MODES_V1.join(", ")}.`,
    );
  }
  return n as AskDbModeV1;
}

export function formatAskDbModesV1(): string {
  return ASKDB_MODES_V1.join("|");
}
