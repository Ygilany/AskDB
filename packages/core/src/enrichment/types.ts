import type { V2Table } from "../schema/v2/physical.js";

/**
 * What to suggest for. The TUI builds one of these per active prompt and asks
 * `suggestEnrichment` for 1–3 candidates the user reviews and confirms.
 */
export type EnrichmentTarget =
  | { kind: "table-description"; table: V2Table }
  | { kind: "table-aliases"; table: V2Table }
  | { kind: "table-primary-entity"; table: V2Table }
  | { kind: "column-description"; table: V2Table; columnId: string }
  | { kind: "column-aliases"; table: V2Table; columnId: string }
  | { kind: "common-query-language"; table: V2Table };

/**
 * One suggestion candidate. For free-text fields, `text` is the value.
 * For list fields (aliases), the TUI splits on `,` after editing.
 */
export type EnrichmentCandidate = {
  /** The suggested text. Whitespace at the ends is stripped. */
  text: string;
};

/**
 * Optional context: neighboring tables (joined via FK) and the schema id, so
 * the model can ground suggestions beyond the immediate table.
 */
export type EnrichmentContext = {
  schemaId: string;
  /** Tables linked to the target table by foreign keys. Capped by the caller. */
  neighbors?: V2Table[];
};
