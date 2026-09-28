import type { StudioTableDto } from "@/shared/api";
import type { TableDraft } from "@askdb/enrich";

export type SensitivityState = {
  /** What the core loader will treat as sensitive once the draft is saved. */
  effective: boolean;
  /**
   * Sensitive regardless of this override, so a "Not sensitive" override would be
   * ignored by the loader (and reported as `sensitivity_downgrade_ignored`).
   */
  forced: boolean;
};

export type TableSensitivity = SensitivityState & {
  /** Keyed by column id; covers every column of the table passed in. */
  columns: Record<string, SensitivityState>;
};

/** Fallback for a column id missing from `TableSensitivity.columns`: fail closed. */
export const UNKNOWN_COLUMN_SENSITIVITY: SensitivityState = { forced: true, effective: true };

/**
 * Effective sensitivity for a table and its columns, mirroring `loadSchema()` in
 * @askdb/core: front-matter overrides are escalate-only. `sensitive: true` marks a
 * table or column sensitive on top of schema.json; `false` never un-marks a table
 * schema.json marks sensitive, nor a column that schema.json marks sensitive, whose
 * table is (effectively) sensitive, or that another table's markdown escalates.
 */
export function tableSensitivity(
  table: Pick<StudioTableDto, "physical" | "escalatedByOtherFiles">,
  draft: TableDraft,
): TableSensitivity {
  const { physical } = table;
  const escalatedElsewhere = new Set(table.escalatedByOtherFiles);
  const tableForced = physical.sensitive === true;
  const tableEffective = tableForced || draft.sensitive === true;
  const columns: Record<string, SensitivityState> = {};
  for (const col of physical.columns) {
    const forced = col.sensitive === true || tableEffective || escalatedElsewhere.has(col.id);
    columns[col.id] = { forced, effective: forced || draft.columns[col.id]?.sensitive === true };
  }
  return { forced: tableForced, effective: tableEffective, columns };
}
