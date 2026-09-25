import { useWorkspace } from "../../contexts/workspace-context";
import { Badge } from "../../components/ui/badge";

export function SensitivityTab() {
  const { selectedTable, selectedDraft, updateColumnDraft, updateTableDraft } = useWorkspace();
  if (!selectedTable || !selectedDraft) return null;

  const table = selectedTable;
  const draft = selectedDraft;
  const tableId = table.physical.id;
  // Mirrors the core loader: overrides are escalate-only. `Sensitive` marks a table or
  // column sensitive on top of schema.json; `Not sensitive` cannot un-mark anything that
  // schema.json (or a sensitive table) already marks sensitive.
  const physicalTableSensitive = table.physical.sensitive === true;
  const tableEffective = physicalTableSensitive || draft.sensitive === true;

  return (
    <div className="stack" style={{ padding: "var(--pad-y) var(--pad-x)" }}>
      <section className="card">
        <div className="card-hd"><h3>LLM tracking</h3></div>
        <div className="card-bd">
          <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
            Untracked tables are excluded from LLM prompts and RAG indexing. They remain in the schema and are still visible here.
          </p>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted" style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Status</span>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={draft.tracked === false ? "false" : "true"}
              onChange={(e) => {
                const val = e.target.value === "false" ? false : undefined;
                updateTableDraft(tableId, (d) => ({ ...d, tracked: val }));
              }}
            >
              <option value="true">Tracked — included in LLM context</option>
              <option value="false">Untracked — excluded from LLM context</option>
            </select>
          </label>
        </div>
      </section>

      <section className="card">
        <div className="card-hd"><h3>Table-level sensitivity</h3></div>
        <div className="card-bd">
          <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
            Overrides can only escalate: marking a table or column sensitive takes effect on top of the physical metadata, but "Not sensitive" cannot un-mark something schema.json already marks sensitive. A sensitive table makes all of its columns sensitive.
          </p>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted" style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Override</span>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={draft.sensitive === undefined ? "inherit" : draft.sensitive ? "true" : "false"}
              onChange={(e) => {
                const val = e.target.value === "inherit" ? undefined : e.target.value === "true";
                updateTableDraft(tableId, (d) => ({ ...d, sensitive: val }));
              }}
            >
              <option value="inherit">Inherit physical metadata</option>
              <option value="true">Sensitive</option>
              <option value="false" disabled={physicalTableSensitive}>Not sensitive</option>
            </select>
          </label>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Effective: {tableEffective ? <Badge variant="danger">sensitive</Badge> : "not sensitive"}
          </p>
        </div>
      </section>

      <section className="card">
        <div className="card-hd"><h3>Column sensitivity</h3></div>
        <div className="card-bd tight">
          <table className="tbl">
            <thead>
              <tr>
                <th>Column</th>
                <th>Physical</th>
                <th>Override</th>
                <th>Effective</th>
              </tr>
            </thead>
            <tbody>
              {table.physical.columns.map((col) => {
                const colDraft = draft.columns[col.id] ?? {};
                const baseline = col.sensitive === true || tableEffective;
                const effective = baseline || colDraft.sensitive === true;
                return (
                  <tr key={col.id}>
                    <td><span className="mono">{col.name}</span></td>
                    <td>{col.sensitive ? <Badge variant="danger">sensitive</Badge> : <span className="muted">—</span>}</td>
                    <td>
                      <select
                        style={{ fontSize: 12, padding: "2px 6px", borderRadius: 4, border: "1px solid var(--border)" }}
                        value={colDraft.sensitive === undefined ? "inherit" : colDraft.sensitive ? "true" : "false"}
                        onChange={(e) => {
                          const val = e.target.value === "inherit" ? undefined : e.target.value === "true";
                          updateColumnDraft(tableId, col.id, (d) => ({ ...d, sensitive: val }));
                        }}
                      >
                        <option value="inherit">Inherit</option>
                        <option value="true">Sensitive</option>
                        <option value="false" disabled={baseline}>Not sensitive</option>
                      </select>
                    </td>
                    <td>
                      {effective ? <Badge variant="danger">sensitive</Badge> : <span className="muted">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
