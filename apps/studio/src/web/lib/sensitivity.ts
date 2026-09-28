import type { V2Table } from "@askdb/core";
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
  columns: Record<string, SensitivityState>;
};

/**
 * Effective sensitivity for a table and its columns, mirroring `loadSchema()` in
 * @askdb/core: front-matter overrides are escalate-only. `sensitive: true` marks a
 * table or column sensitive on top of schema.json; `false` never un-marks a table
 * schema.json marks sensitive, nor a column that schema.json marks sensitive or whose
 * table is (effectively) sensitive.
 */
export function tableSensitivity(physical: V2Table, draft: TableDraft): TableSensitivity {
  const tableForced = physical.sensitive === true;
  const tableEffective = tableForced || draft.sensitive === true;
  const columns: Record<string, SensitivityState> = {};
  for (const col of physical.columns) {
    const forced = col.sensitive === true || tableEffective;
    columns[col.id] = { forced, effective: forced || draft.columns[col.id]?.sensitive === true };
  }
  return { forced: tableForced, effective: tableEffective, columns };
}
