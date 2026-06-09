import { ChevronRight } from "lucide-react";
import { useWorkspace } from "../../contexts/workspace-context";
import { Badge } from "../../components/ui/badge";

export function SchemaTab() {
  const { selectedTable } = useWorkspace();
  if (!selectedTable) return null;

  const table = selectedTable;

  return (
    <div className="stack" style={{ padding: "var(--pad-y) var(--pad-x)" }}>
      <section className="card">
        <div className="card-hd"><h3>Column Details</h3></div>
        <div className="card-bd tight">
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Nullable</th>
                <th>PK</th>
                <th>Default</th>
                <th>Sensitive</th>
              </tr>
            </thead>
            <tbody>
              {table.physical.columns.map((col) => (
                <tr key={col.id}>
                  <td><span className="mono">{col.name}</span></td>
                  <td><Badge variant="outline">{col.type}</Badge></td>
                  <td>{col.nullable ? "Yes" : "No"}</td>
                  <td>{col.primaryKey ? <Badge variant="secondary">PK</Badge> : "—"}</td>
                  <td className="muted tiny">{col.default ?? "—"}</td>
                  <td>{col.sensitive ? <Badge variant="danger">sensitive</Badge> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {table.physical.relationships && table.physical.relationships.length > 0 && (
        <section className="card">
          <div className="card-hd"><h3>Relationships</h3></div>
          <div className="card-bd">
            <div style={{ display: "grid", gap: 8 }}>
              {table.physical.relationships.map((rel, i) => (
                <div className="relationship-row" key={`${rel.from}-${rel.to}-${i}`}>
                  <span style={{ wordBreak: "break-all" }}>{rel.from}</span>
                  <ChevronRight size={14} style={{ color: "var(--ink-400)", flexShrink: 0 }} />
                  <span style={{ wordBreak: "break-all" }}>{rel.to}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
