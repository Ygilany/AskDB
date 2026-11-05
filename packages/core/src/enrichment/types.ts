import type { V2Table } from "../schema/v2/physical.js";

/**
 * What to suggest for. An authoring surface (Studio) builds one of these per
 * active prompt and asks `suggestEnrichment` for 1–3 candidates the user
 * reviews and confirms.
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
 * For list fields (aliases), the authoring surface splits on `,` after editing.
 */
export type EnrichmentCandidate = {
  /** The suggested text. Whitespace at the ends is stripped. */
  text: string;
};

/** How the enrichment prompt treats sensitive columns. */
export type EnrichmentPromptOptions = {
  /**
   * When true, sensitive columns and every column of a sensitive table are left out of the
   * prompt, by the same rule as `ask()`'s `omitSensitiveIdentifiersFromNlToSqlPrompt`; a
   * sensitive table keeps its name. A target that is itself a sensitive column is refused with
   * `SensitiveEnrichmentTargetError`. Hosts pass their `modes.omitSensitiveFromPrompt` here.
   * Default false: sensitive columns are listed, tagged `(sensitive)`.
   */
  omitSensitiveIdentifiersFromPrompt?: boolean;
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
