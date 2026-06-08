import { useEffect, useCallback } from "react";
import { Loader2, Lock, Play, Shield, Sparkles } from "lucide-react";
import { useWorkspace } from "../../contexts/workspace-context";
import { useRag } from "../../contexts/rag-context";
import { usePlayground } from "../../contexts/playground-context";
import { Field, Textarea } from "../../components/ui";
import { CopyButton } from "../../components/common/CopyButton";
import { InlineStatus } from "../../components/common/StatusBanner";
import { EmptyText } from "../../components/common/EmptyText";

export function PlaygroundPage() {
  const { workspace } = useWorkspace();
  const { ragAvailable } = useRag();
  const {
    askQuestion, setAskQuestion, askMode, setAskMode,
    askMessage, askResult,
    askTenantEnabled, setAskTenantEnabled,
    askTenantScopeJson, setAskTenantScopeJson,
    askTenantSqlMode, setAskTenantSqlMode,
    executeResult, executeMessage,
    historyEntries, busy,
    handleAsk, handleExecute, loadHistoryEntry, handleDeleteHistory,
  } = usePlayground();

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !busy.has("ask")) {
      e.preventDefault();
      void handleAsk();
    }
  }, [busy, handleAsk]);

  useEffect(() => {
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  if (!workspace) return null;

  const hasTenantPolicy = Boolean(workspace.tenantPolicy);

  return (
    <main className="main-pane">
      <div className="main-hd">
        <div className="main-title">
          <h1><Play size={18} style={{ display: "inline", marginRight: 8 }} />Query Playground</h1>
          <div className="main-sub">Generate SQL from natural language and execute it against your database</div>
        </div>
      </div>
      <div className="main-body" style={{ overflow: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 3fr", minHeight: "100%" }}>
          {/* Left: Question + History */}
          <div style={{ borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "var(--pad-y) var(--pad-x)" }}>
              <div style={{ display: "grid", gap: 12 }}>
                <Field label="Natural language question">
                  <Textarea
                    value={askQuestion}
                    onChange={(e) => setAskQuestion(e.target.value)}
                    placeholder="How many users placed orders last month?"
                    rows={4}
                  />
                </Field>

                <div style={{ display: "grid", gap: 6 }}>
                  <span className="muted" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Retrieval mode</span>
                  <fieldset className="toggle-seg">
                    <button className={askMode === "full" ? "active" : ""} onClick={() => setAskMode("full")}>
                      Full schema
                    </button>
                    <button
                      className={askMode === "rag" ? "active" : ""}
                      disabled={!ragAvailable}
                      title={!ragAvailable ? "Build the RAG index first to query with retrieval." : undefined}
                      onClick={() => setAskMode("rag")}
                    >
                      {!ragAvailable && <Lock size={12} />}
                      RAG
                    </button>
                  </fieldset>
                </div>

                {hasTenantPolicy && (
                  <div style={{ display: "grid", gap: 6 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={askTenantEnabled}
                        onChange={(e) => setAskTenantEnabled(e.target.checked)}
                      />
                      <span className="muted" style={{ fontSize: 11, fontWeight: 600 }}>
                        <Shield size={12} style={{ display: "inline", marginRight: 4 }} />
                        Tenant scope
                      </span>
                    </label>
                    {askTenantEnabled && (
                      <div style={{ display: "grid", gap: 8 }}>
                        <Field label="Scope JSON">
                          <Textarea
                            className="font-mono text-xs"
                            value={askTenantScopeJson}
                            onChange={(e) => setAskTenantScopeJson(e.target.value)}
                            placeholder={'{\n  "access": {\n    "kind": "ids",\n    "tenantRoot": "orgs",\n    "ids": ["org-1"]\n  }\n}'}
                            rows={5}
                          />
                        </Field>
                        <div style={{ display: "grid", gap: 6 }}>
                          <span className="muted" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>SQL output mode</span>
                          <fieldset className="toggle-seg">
                            <button className={askTenantSqlMode === "sql-only" ? "active" : ""} onClick={() => setAskTenantSqlMode("sql-only")}>
                              Inline literals
                            </button>
                            <button className={askTenantSqlMode === "sql-params" ? "active" : ""} onClick={() => setAskTenantSqlMode("sql-params")}>
                              $N parameters
                            </button>
                          </fieldset>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <button className="btn primary" disabled={busy.has("ask")} onClick={() => void handleAsk()} title="Generate SQL (⌘↵)">
                  {busy.has("ask") ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  Generate SQL
                  <kbd className="kbd" style={{ marginLeft: 4, opacity: 0.7 }}>⌘↵</kbd>
                </button>
                {askMessage && <InlineStatus status={askMessage} />}
              </div>
            </div>

            {historyEntries.length > 0 && (
              <div style={{ borderTop: "1px solid var(--border)", flex: 1, overflow: "auto" }}>
                <div style={{ padding: "8px var(--pad-x)" }}>
                  <span className="muted" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    History ({historyEntries.length})
                  </span>
                </div>
                <div>
                  {historyEntries.slice(0, 20).map((h) => (
                    <div
                      key={h.id}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                        padding: "6px var(--pad-x)", cursor: "pointer", fontSize: 12,
                        borderBottom: "1px solid var(--border)",
                      }}
                      onClick={() => loadHistoryEntry(h)}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                        {h.question}
                      </span>
                      <span className={`chip ${h.mode === "rag" ? "red" : ""}`} style={{ flexShrink: 0 }}>{h.mode}</span>
                      <button
                        className="btn ghost sm"
                        onClick={(e) => { e.stopPropagation(); void handleDeleteHistory(h.id); }}
                        title="Delete"
                        style={{ flexShrink: 0, padding: 2 }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: Results */}
          <div style={{ overflow: "auto" }}>
            {!askResult ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", padding: 32 }}>
                <EmptyText text="Ask a question to generate SQL" />
              </div>
            ) : (
              <div style={{ display: "grid", gap: 0 }}>
                <section style={{ padding: "var(--pad-y) var(--pad-x)", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <h3 style={{ fontSize: 13, fontWeight: 600 }}>Generated SQL</h3>
                    {askResult.sql && <CopyButton value={askResult.sql} />}
                  </div>
                  {askResult.sql ? (
                    <pre className="sql-block">{askResult.sql}</pre>
                  ) : (
                    <EmptyText text="No SQL generated." />
                  )}
                </section>

                {askResult.explain !== null && askResult.explain !== undefined && (
                  <section style={{ padding: "var(--pad-y) var(--pad-x)", borderBottom: "1px solid var(--border)" }}>
                    <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Explain</h3>
                    <pre className="plain-block">{formatUnknown(askResult.explain)}</pre>
                  </section>
                )}

                {askResult.tenant?.enabled && (
                  <section style={{ padding: "var(--pad-y) var(--pad-x)", borderBottom: "1px solid var(--border)" }}>
                    <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Tenant Params</h3>
                    {askResult.tenant.params.length > 0 ? (
                      <div style={{ padding: 8, border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 12 }}>
                        <span style={{ fontWeight: 600 }}>Positional params:</span>{" "}
                        <code>{JSON.stringify(askResult.tenant.params)}</code>
                      </div>
                    ) : (
                      <EmptyText text="No tenant params." />
                    )}
                  </section>
                )}

                <div style={{ padding: "var(--pad-y) var(--pad-x)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
                  <button
                    className="btn primary"
                    disabled={busy.has("execute") || !askResult.sql}
                    onClick={() => void handleExecute()}
                  >
                    {busy.has("execute") ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                    Execute Query
                  </button>
                  {executeMessage && <InlineStatus status={executeMessage} />}
                </div>

                {executeResult?.ok === true && (
                  <section style={{ padding: "var(--pad-y) var(--pad-x)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <h3 style={{ fontSize: 13, fontWeight: 600 }}>Results</h3>
                      {executeResult.truncated && (
                        <span className="chip amber">Showing first 500 rows</span>
                      )}
                    </div>
                    {executeResult.columns && executeResult.rows ? (
                      <div style={{ overflowX: "auto" }}>
                        <table className="tbl">
                          <thead>
                            <tr>
                              {executeResult.columns.map((col) => (
                                <th key={col}>{col}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {executeResult.rows.map((row, ri) => (
                              <tr key={ri}>
                                {(row as unknown[]).map((cell, ci) => (
                                  <td key={ci} className="mono" style={{ fontSize: 11 }}>
                                    {cell === null || cell === undefined
                                      ? <span className="muted">NULL</span>
                                      : String(cell)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <EmptyText text="No results." />
                    )}
                  </section>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}
