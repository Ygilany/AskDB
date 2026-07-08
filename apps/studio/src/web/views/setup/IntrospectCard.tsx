import { Database, Loader2, Sparkles } from "lucide-react";

export function IntrospectCard({
  stepNumber,
  busy,
  onIntrospect,
}: {
  stepNumber: number;
  busy: "config" | "introspect" | null;
  onIntrospect: () => void;
}) {
  return (
    <div className="card">
      <div className="card-hd">
        <h3><Sparkles size={14} /> {stepNumber} · Introspect your database</h3>
      </div>
      <div className="card-bd" style={{ display: "grid", gap: 10 }}>
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
          Reads your schema structure (tables, columns, relationships — never rows) and writes the
          schema artifact. When it finishes, Studio opens on the Overview.
        </p>
        <div>
          <button type="button" className="btn primary" disabled={busy === "introspect"} onClick={onIntrospect}>
            {busy === "introspect" ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
            Run introspection
          </button>
        </div>
      </div>
    </div>
  );
}
