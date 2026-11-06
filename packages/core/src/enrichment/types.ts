import type { NormalizedV2Table } from "../schema/v2/normalized.js";

/**
 * What to suggest for. An authoring surface (Studio) builds one of these per
 * active prompt and asks `suggestEnrichment` for 1–3 candidates the user
 * reviews and confirms.
 *
 * `table` is a table from `loadSchema()`'s result, as `@askdb/enrich`'s
 * `buildSuggestionTarget` returns, so it carries effective sensitivity (front-matter
 * escalation included), which the enrichment prompt's omission rule reads (ADR 0026).
 */
export type EnrichmentTarget =
  | { kind: "table-description"; table: NormalizedV2Table }
  | { kind: "table-aliases"; table: NormalizedV2Table }
  | { kind: "table-primary-entity"; table: NormalizedV2Table }
  | { kind: "column-description"; table: NormalizedV2Table; columnId: string }
  | { kind: "column-aliases"; table: NormalizedV2Table; columnId: string }
  | { kind: "common-query-language"; table: NormalizedV2Table };

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
  /**
   * Tables linked to the target table by foreign keys, from `loadSchema()`'s result
   * like the target. Capped by the caller; untracked tables are the caller's to leave out.
   */
  neighbors?: NormalizedV2Table[];
};
