import { useWorkspace } from "../../contexts/workspace-context";
import { Badge } from "../../components/ui";

export function SensitivityTab() {
  const { selectedTable, selectedDraft, updateColumnDraft, updateTableDraft } = useWorkspace();
  if (!selectedTable || !selectedDraft) return null;

  const table = selectedTable;
  const draft = selectedDraft;
  const tableId = table.physical.id;

  return (
    <div className="stack" style={{ padding: "var(--pad-y) var(--pad-x)" }}>
      <section className="card">
        <div className="card-hd"><h3>Table-level sensitivity</h3></div>
        <div className="card-bd">
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Override</span>
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
              <option value="false">Not sensitive</option>
            </select>
          </label>
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
                const effective = colDraft.sensitive !== undefined ? colDraft.sensitive : col.sensitive;
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
                        <option value="false">Not sensitive</option>
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
