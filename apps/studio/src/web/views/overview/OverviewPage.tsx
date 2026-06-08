import { useNavigate } from "react-router";
import { Sparkles, Shield, History, Zap, RefreshCw, Check, X } from "lucide-react";
import { useWorkspace } from "../../contexts/workspace-context";
import { useRag } from "../../contexts/rag-context";
import { usePlayground } from "../../contexts/playground-context";
import { formatNumber } from "../../lib/format";

export function OverviewPage() {
  const navigate = useNavigate();
  const { workspace, tables } = useWorkspace();
  const { ragStatus } = useRag();
  const { historyEntries } = usePlayground();

  if (!workspace) return null;

  const enrichedCount = tables.filter((t) => {
    const d = t.draft;
    const hasSome = d.description || (d.aliases && d.aliases.length > 0);
    const allCols = Object.values(d.columns ?? {}).every((c) => c.description);
    return hasSome && allCols;
  }).length;
  const partialCount = tables.filter((t) => {
    const d = t.draft;
    const hasSome = d.description || (d.aliases && d.aliases.length > 0);
    const allCols = Object.values(d.columns ?? {}).every((c) => c.description);
    return hasSome && !allCols;
  }).length;

  const tenancyConfigured = Boolean(workspace.tenantPolicy);

  return (
    <main className="main-pane">
      <div className="main-hd">
        <div className="main-title">
          <h1>Overview</h1>
          <div className="main-sub">{workspace.aiProvider || "postgres"} · {workspace.schemaId}</div>
        </div>
        <div className="main-actions">
          <button type="button" className="btn" onClick={() => void 0}>
            <RefreshCw size={14} /> Resync schema
          </button>
          <button type="button" className="btn primary" onClick={() => navigate("/tables")}>
            <Sparkles size={14} /> Draft enrichment
          </button>
        </div>
      </div>
      <div className="main-body">
        <div className="stack">
          {/* Stats row */}
          <div className="grid-4">
            <div className="card stat-card">
              <div className="stat-label">Tables</div>
              <div className="stat-num">{tables.length}</div>
              <div className="stat-hint">{enrichedCount} enriched · {partialCount} partial</div>
            </div>
            <div className="card stat-card">
              <div className="stat-label">Concepts</div>
              <div className="stat-num">{workspace.concepts.length}</div>
              {workspace.concepts.length > 0 && (
                <div className="stat-hint">{workspace.concepts.length} defined</div>
              )}
            </div>
            <div className="card stat-card">
              <div className="stat-label">Index health</div>
              <div className="stat-num">
                {ragStatus?.hasIndex ? (ragStatus.stale ? "Stale" : "Fresh") : "None"}
              </div>
              {ragStatus && (
                <div className="stat-hint">
                  {ragStatus.chunksTotal} chunks · {ragStatus.dimensions}d
                </div>
              )}
            </div>
            <div className="card stat-card">
              <div className="stat-label">Sensitivity coverage</div>
              <div className="stat-num">
                {ragStatus ? `${Math.round(((ragStatus.sensitiveExcluded + ragStatus.sensitiveIncluded) / Math.max(ragStatus.chunksTotal, 1)) * 100)}%` : "—"}
              </div>
            </div>
          </div>

          {/* Two-column row */}
          <div className="grid-2">
            <div className="card">
              <div className="card-hd">
                <h3><Sparkles size={14} /> Pending enrichment</h3>
                <span className="card-meta">{tables.length - enrichedCount} tables to go</span>
              </div>
              <div className="card-bd tight">
                <table className="tbl">
                  <thead>
                    <tr><th>Table</th><th>Cols</th><th>Status</th><th aria-label="Actions"></th></tr>
                  </thead>
                  <tbody>
                    {tables
                      .filter((t) => {
                        const d = t.draft;
                        const allCols = Object.values(d.columns ?? {}).every((c) => c.description);
                        return !(d.description && allCols);
                      })
                      .slice(0, 6)
                      .map((t) => {
                        const hasSome = t.draft.description || (t.draft.aliases && t.draft.aliases.length > 0);
                        const level = hasSome ? "partial" : "none";
                        return (
                          <tr
                            key={t.physical.id}
                            style={{ cursor: "default" }}
                            onClick={() => navigate(`/tables/${t.physical.schema}/${t.physical.name}/enrichment`)}
                          >
                            <td><span className="mono">{t.physical.schema}.{t.physical.name}</span></td>
                            <td className="muted">{t.physical.columns.length}</td>
                            <td>
                              <span className={`enrich-dot ${level}`} />
                              <span className="muted tiny" style={{ marginLeft: 6 }}>{level}</span>
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <span className="suggest-link"><Sparkles size={12} /> Draft</span>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <div className="card-hd">
                <h3><History size={14} /> Recent playground queries</h3>
                <span className="card-meta">last {historyEntries.length} queries</span>
              </div>
              <div className="card-bd tight">
                <table className="tbl">
                  <thead>
                    <tr><th>Question</th><th>Mode</th><th>Time</th></tr>
                  </thead>
                  <tbody>
                    {historyEntries.slice(0, 5).map((h) => (
                      <tr key={h.id}>
                        <td style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {h.question}
                        </td>
                        <td>
                          <span className={`chip ${h.mode === "rag" ? "red" : ""}`}>{h.mode}</span>
                        </td>
                        <td className="muted tiny">{new Date(h.timestamp).toLocaleString()}</td>
                      </tr>
                    ))}
                    {historyEntries.length === 0 && (
                      <tr><td colSpan={3} className="muted tiny" style={{ textAlign: "center", padding: 16 }}>No queries yet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Three-column row */}
          <div className="grid-3">
            <div className="card">
              <div className="card-hd"><h3><Sparkles size={14} /> RAG index</h3></div>
              <div className="card-bd">
                {ragStatus ? (
                  <>
                    <div className="grid-2" style={{ gap: 10 }}>
                      <div><div className="muted tiny">Chunks</div><div style={{ fontSize: 18, fontWeight: 600 }}>{formatNumber(ragStatus.chunksTotal)}</div></div>
                      <div><div className="muted tiny">Indexed</div><div style={{ fontSize: 18, fontWeight: 600 }}>{formatNumber(ragStatus.chunksIndexed)}</div></div>
                      <div><div className="muted tiny">Dimensions</div><div className="mono" style={{ fontSize: 13 }}>{formatNumber(ragStatus.dimensions)}</div></div>
                      <div><div className="muted tiny">Model</div><div className="mono" style={{ fontSize: 12 }}>{ragStatus.embedder.label}</div></div>
                    </div>
                    <div className="bar" style={{ marginTop: 14 }}>
                      <i style={{ width: ragStatus.chunksTotal > 0 ? `${Math.round((ragStatus.chunksIndexed / ragStatus.chunksTotal) * 100)}%` : "0%" }} />
                    </div>
                    <div className="tiny muted" style={{ marginTop: 6 }}>
                      Updated: {ragStatus.updatedAt ?? "never"}
                    </div>
                  </>
                ) : (
                  <div className="muted tiny">RAG status unavailable</div>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-hd"><h3><Shield size={14} /> Tenancy</h3></div>
              <div className="card-bd">
                <div className="row-h" style={{ marginBottom: 10 }}>
                  <span className={`chip ${tenancyConfigured ? "green" : "amber"}`}>
                    <Zap size={11} />
                    {tenancyConfigured ? "Configured" : "Not configured"}
                  </span>
                </div>
                <div className="tiny muted" style={{ lineHeight: 1.6 }}>
                  {tenancyConfigured
                    ? `${workspace.tenantPolicy!.roots.length} root(s) configured, ${workspace.tenantPolicy!.enforcement} mode.`
                    : "Multi-tenant scoping isn't set. Generated SQL won't enforce row-level isolation."}
                </div>
                {!tenancyConfigured && (
                  <button type="button" className="btn sm primary" style={{ marginTop: 12 }} onClick={() => navigate("/tenancy")}>
                    <Sparkles size={12} /> Draft tenant policy
                  </button>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-hd"><h3><Zap size={14} /> Suggested next actions</h3></div>
              <div className="card-bd" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {tables.filter((t) => !t.draft.description).length > 0 && (
                  <div className="row-h">
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--red-600)", flexShrink: 0 }} />
                    <span style={{ fontSize: 12.5 }}>
                      Add description to{" "}
                      <span className="mono">{tables.find((t) => !t.draft.description)?.physical.name}</span>
                    </span>
                  </div>
                )}
                {!ragStatus?.hasIndex && (
                  <div className="row-h">
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--amber-500)", flexShrink: 0 }} />
                    <span style={{ fontSize: 12.5 }}>Build RAG index for retrieval-augmented queries</span>
                  </div>
                )}
                {ragStatus?.stale && (
                  <div className="row-h">
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ink-400)", flexShrink: 0 }} />
                    <span style={{ fontSize: 12.5 }}>Rebuild index — tables changed since last build</span>
                  </div>
                )}
                {tables.length > 0 && enrichedCount === 0 && (
                  <div className="row-h">
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--amber-500)", flexShrink: 0 }} />
                    <span style={{ fontSize: 12.5 }}>Start enriching tables to improve SQL generation quality</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
