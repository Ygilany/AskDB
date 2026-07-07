import { useEffect, useCallback, useState } from "react";
import { Check, ChevronDown, ChevronRight, Loader2, Lock, Play, Plus, Shield, Sparkles, Trash2 } from "lucide-react";
import { useWorkspace } from "../../contexts/workspace-context";
import { useRag } from "../../contexts/rag-context";
import { usePlayground } from "../../contexts/playground-context";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { CopyButton } from "../../components/common/CopyButton";
import { InlineStatus } from "../../components/common/StatusBanner";
import { EmptyText } from "../../components/common/EmptyText";
import { GetTheCodePanel } from "./GetTheCodePanel";
import { UsageSummary } from "../../components/common/UsageSummary";

const selectClassName = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const fieldsetResetStyle = { border: 0, padding: 0, margin: 0 };

function makeDraftRowId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

export function PlaygroundPage() {
  const { workspace } = useWorkspace();
  const { ragAvailable } = useRag();
  const {
    askQuestion, setAskQuestion, askMode, setAskMode,
    askMessage, askResult,
    askTenantEnabled, setAskTenantEnabled,
    askTenantAccessKind, setAskTenantAccessKind,
    askTenantRoot, setAskTenantRoot,
    askTenantIdsText, setAskTenantIdsText,
    askTenantMultiRootRows, setAskTenantMultiRootRows,
    askTenantGlobalReason, setAskTenantGlobalReason,
    askTenantContext, setAskTenantContext,
    askTenantContextAttributes, setAskTenantContextAttributes,
    askTenantFilterRows, setAskTenantFilterRows,
    generatedTenantScopeJson, tenantScopeValidationError,
    askTenantSqlMode, setAskTenantSqlMode,
    executeResult, executeMessage, executeStatus,
    historyEntries, busy,
    handleAsk, handleExecute, loadHistoryEntry, handleDeleteHistory, handleInstallExecuteDriver,
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
  const tenantRoots = workspace.tenantPolicy?.roots ?? [];
  const polymorphicTables = workspace.tenantPolicy?.polymorphicTables ?? [];
  const firstTenantRoot = tenantRoots[0]?.id ?? "";
  const firstPolymorphicTable = polymorphicTables[0];

  return (
    <main className="main-pane">
      <div className="main-hd">
        <div className="main-title">
          <h1><Play size={18} style={{ display: "inline", marginRight: 8 }} />Query Playground</h1>
          <div className="main-sub">Generate SQL from natural language and execute it against your database</div>
        </div>
      </div>
      <div className="main-body" style={{ overflow: "hidden", padding: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 3fr", height: "100%" }}>
          {/* Left: Question + History */}
          <div style={{ borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "auto" }}>
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
                  <fieldset className="toggle-seg" style={fieldsetResetStyle}>
                    <legend className="sr-only">Retrieval mode</legend>
                    <button className={askMode === "full" ? "active" : ""} onClick={() => setAskMode("full")}>
                      Full schema
                    </button>
                    <button
                      className={askMode === "rag" ? "active" : ""}
                      disabled={!ragAvailable}
                      title={!ragAvailable ? "Build the RAG index first to query with retrieval." : undefined}
                      onClick={() => setAskMode("rag")}
                    >
                      {!ragAvailable && <Lock size={12} style={{ display: "inline", marginRight: 4 }} />}
                      RAG
                    </button>
                  </fieldset>
                </div>

                {hasTenantPolicy && (
                  <div style={{ display: "grid", gap: 10 }}>
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
                      <div style={{ display: "grid", gap: 10 }}>
                        <div style={{ display: "grid", gap: 6 }}>
                          <span className="muted" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Access kind</span>
                          <fieldset className="toggle-seg" style={fieldsetResetStyle}>
                            <legend className="sr-only">Tenant scope access kind</legend>
                            <button className={askTenantAccessKind === "ids" ? "active" : ""} onClick={() => setAskTenantAccessKind("ids")}>
                              IDs
                            </button>
                            <button className={askTenantAccessKind === "subtree" ? "active" : ""} onClick={() => setAskTenantAccessKind("subtree")}>
                              Subtree
                            </button>
                            <button className={askTenantAccessKind === "multi_root" ? "active" : ""} onClick={() => setAskTenantAccessKind("multi_root")}>
                              Multi-root
                            </button>
                            <button className={askTenantAccessKind === "global" ? "active" : ""} onClick={() => setAskTenantAccessKind("global")}>
                              Super / global
                            </button>
                          </fieldset>
                        </div>

                        {(askTenantAccessKind === "ids" || askTenantAccessKind === "subtree") && (
                          <div style={{ display: "grid", gap: 8 }}>
                            <Field label="Tenant root">
                              <select className={selectClassName} value={askTenantRoot} onChange={(e) => setAskTenantRoot(e.target.value)}>
                                {tenantRoots.map((root) => (
                                  <option key={root.id} value={root.id}>{root.label} ({root.id})</option>
                                ))}
                              </select>
                            </Field>
                            <Field
                              label={askTenantAccessKind === "ids" ? "Tenant IDs" : "Subtree root IDs"}
                              description="Comma-separated IDs from your app's auth context."
                            >
                              <Input
                                value={askTenantIdsText}
                                onChange={(e) => setAskTenantIdsText(e.target.value)}
                                placeholder={askTenantAccessKind === "ids" ? "org-1, org-2" : "region-1"}
                              />
                            </Field>
                          </div>
                        )}

                        {askTenantAccessKind === "multi_root" && (
                          <div style={{ display: "grid", gap: 8 }}>
                            {askTenantMultiRootRows.map((row, index) => (
                              <div key={row.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) auto", gap: 8, alignItems: "end" }}>
                                <Field label={index === 0 ? "Tenant root" : "Tenant root"} className="min-w-0">
                                  <select
                                    className={selectClassName}
                                    value={row.tenantRoot}
                                    onChange={(e) => {
                                      const next = [...askTenantMultiRootRows];
                                      next[index] = { ...row, tenantRoot: e.target.value };
                                      setAskTenantMultiRootRows(next);
                                    }}
                                  >
                                    {tenantRoots.map((root) => (
                                      <option key={root.id} value={root.id}>{root.label} ({root.id})</option>
                                    ))}
                                  </select>
                                </Field>
                                <Field label="IDs" className="min-w-0">
                                  <Input
                                    value={row.idsText}
                                    onChange={(e) => {
                                      const next = [...askTenantMultiRootRows];
                                      next[index] = { ...row, idsText: e.target.value };
                                      setAskTenantMultiRootRows(next);
                                    }}
                                    placeholder="org-1, org-2"
                                  />
                                </Field>
                                <button
                                  className="btn ghost sm"
                                  disabled={askTenantMultiRootRows.length === 1}
                                  onClick={() => setAskTenantMultiRootRows(askTenantMultiRootRows.filter((_, i) => i !== index))}
                                  title="Remove scope row"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            ))}
                            <div>
                              <button
                                className="btn ghost sm"
                                onClick={() => setAskTenantMultiRootRows([
                                  ...askTenantMultiRootRows,
                                  { id: makeDraftRowId("multi-root"), tenantRoot: firstTenantRoot, idsText: "" },
                                ])}
                              >
                                <Plus size={14} />
                                Add root
                              </button>
                            </div>
                          </div>
                        )}

                        {askTenantAccessKind === "global" && (
                          <Field label="Super / global reason" description="Required for audit context.">
                            <Input
                              value={askTenantGlobalReason}
                              onChange={(e) => setAskTenantGlobalReason(e.target.value)}
                              placeholder="superuser access for support investigation"
                            />
                          </Field>
                        )}

                        <details>
                          <summary className="muted" style={{ cursor: "pointer", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                            Advisory context
                          </summary>
                          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                              <Field label="Role">
                                <Input value={askTenantContext.role} onChange={(e) => setAskTenantContext({ ...askTenantContext, role: e.target.value })} placeholder="regional_manager" />
                              </Field>
                              <Field label="Label">
                                <Input value={askTenantContext.label} onChange={(e) => setAskTenantContext({ ...askTenantContext, label: e.target.value })} placeholder="Jane Smith, Northeast" />
                              </Field>
                              <Field label="Department">
                                <Input value={askTenantContext.department} onChange={(e) => setAskTenantContext({ ...askTenantContext, department: e.target.value })} placeholder="operations" />
                              </Field>
                              <Field label="Region">
                                <Input value={askTenantContext.region} onChange={(e) => setAskTenantContext({ ...askTenantContext, region: e.target.value })} placeholder="northeast" />
                              </Field>
                            </div>
                            <Field label="Description">
                              <Textarea
                                value={askTenantContext.description}
                                onChange={(e) => setAskTenantContext({ ...askTenantContext, description: e.target.value })}
                                placeholder="Business context for this user's scope."
                                rows={2}
                              />
                            </Field>
                            {askTenantContextAttributes.map((attribute, index) => (
                              <div key={attribute.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) auto", gap: 8, alignItems: "end" }}>
                                <Field label="Attribute key" className="min-w-0">
                                  <Input
                                    value={attribute.key}
                                    onChange={(e) => {
                                      const next = [...askTenantContextAttributes];
                                      next[index] = { ...attribute, key: e.target.value };
                                      setAskTenantContextAttributes(next);
                                    }}
                                    placeholder="team"
                                  />
                                </Field>
                                <Field label="Attribute value" className="min-w-0">
                                  <Input
                                    value={attribute.value}
                                    onChange={(e) => {
                                      const next = [...askTenantContextAttributes];
                                      next[index] = { ...attribute, value: e.target.value };
                                      setAskTenantContextAttributes(next);
                                    }}
                                    placeholder="field-sales"
                                  />
                                </Field>
                                <button
                                  className="btn ghost sm"
                                  onClick={() => setAskTenantContextAttributes(askTenantContextAttributes.filter((_, i) => i !== index))}
                                  title="Remove attribute"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            ))}
                            <div>
                              <button
                                className="btn ghost sm"
                                onClick={() => setAskTenantContextAttributes([
                                  ...askTenantContextAttributes,
                                  { id: makeDraftRowId("context-attribute"), key: "", value: "" },
                                ])}
                              >
                                <Plus size={14} />
                                Add attribute
                              </button>
                            </div>
                          </div>
                        </details>

                        {polymorphicTables.length > 0 && (
                          <details>
                            <summary className="muted" style={{ cursor: "pointer", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                              Tenant filters
                            </summary>
                            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                              {askTenantFilterRows.map((row, index) => (
                                <div key={row.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr) 88px minmax(0, 1fr) auto", gap: 8, alignItems: "end" }}>
                                  <Field label="Table" className="min-w-0">
                                    <select
                                      className={selectClassName}
                                      value={row.tableId}
                                      onChange={(e) => {
                                        const selected = polymorphicTables.find((table) => table.id === e.target.value);
                                        const next = [...askTenantFilterRows];
                                        next[index] = { ...row, tableId: e.target.value, column: row.column || selected?.typeColumn || "" };
                                        setAskTenantFilterRows(next);
                                      }}
                                    >
                                      {polymorphicTables.map((table) => (
                                        <option key={table.id} value={table.id}>{table.id}</option>
                                      ))}
                                    </select>
                                  </Field>
                                  <Field label="Column" className="min-w-0">
                                    <Input
                                      value={row.column}
                                      onChange={(e) => {
                                        const next = [...askTenantFilterRows];
                                        next[index] = { ...row, column: e.target.value };
                                        setAskTenantFilterRows(next);
                                      }}
                                      placeholder="owner_type"
                                    />
                                  </Field>
                                  <Field label="Operator" className="min-w-0">
                                    <select
                                      className={selectClassName}
                                      value={row.operator}
                                      onChange={(e) => {
                                        const next = [...askTenantFilterRows];
                                        next[index] = { ...row, operator: e.target.value as typeof row.operator };
                                        setAskTenantFilterRows(next);
                                      }}
                                    >
                                      <option value="=">=</option>
                                      <option value="IN">IN</option>
                                      <option value="!=">!=</option>
                                      <option value="NOT IN">NOT IN</option>
                                    </select>
                                  </Field>
                                  <Field label="Value" className="min-w-0">
                                    <Input
                                      value={row.valueText}
                                      onChange={(e) => {
                                        const next = [...askTenantFilterRows];
                                        next[index] = { ...row, valueText: e.target.value };
                                        setAskTenantFilterRows(next);
                                      }}
                                      placeholder={row.operator === "IN" || row.operator === "NOT IN" ? "client, agency" : "client"}
                                    />
                                  </Field>
                                  <button
                                    className="btn ghost sm"
                                    onClick={() => setAskTenantFilterRows(askTenantFilterRows.filter((_, i) => i !== index))}
                                    title="Remove condition"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              ))}
                              <div>
                                <button
                                  className="btn ghost sm"
                                  onClick={() => setAskTenantFilterRows([
                                    ...askTenantFilterRows,
                                    {
                                      id: makeDraftRowId("tenant-filter"),
                                      tableId: firstPolymorphicTable!.id,
                                      column: firstPolymorphicTable!.typeColumn,
                                      operator: "=",
                                      valueText: "",
                                    },
                                  ])}
                                >
                                  <Plus size={14} />
                                  Add condition
                                </button>
                              </div>
                            </div>
                          </details>
                        )}

                        <div style={{ display: "grid", gap: 6 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                            <span className="muted" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>tenantScope JSON preview</span>
                            {generatedTenantScopeJson && <CopyButton value={generatedTenantScopeJson} />}
                          </div>
                          <pre
                            className="mono"
                            style={{
                              minHeight: 116,
                              margin: 0,
                              overflow: "auto",
                              whiteSpace: "pre-wrap",
                              border: "1px solid var(--border)",
                              borderRadius: 6,
                              padding: 10,
                              fontSize: 11,
                              background: "var(--surface-2)",
                            }}
                          >
                            {generatedTenantScopeJson || tenantScopeValidationError || "Complete the tenant scope fields to preview the JSON passed to ask()."}
                          </pre>
                          {tenantScopeValidationError && (
                            <span style={{ color: "var(--red-600)", fontSize: 12 }}>{tenantScopeValidationError}</span>
                          )}
                        </div>

                        <div style={{ display: "grid", gap: 6 }}>
                          <span className="muted" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>SQL output mode</span>
                          <fieldset className="toggle-seg" style={fieldsetResetStyle}>
                            <legend className="sr-only">SQL output mode</legend>
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
                    <ExplainSection explain={askResult.explain} />
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

                <div style={{ padding: "var(--pad-y) var(--pad-x)", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
                  {executeStatus && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span className="muted" style={{ fontSize: 11, fontWeight: 600 }}>
                        {executeStatus.label}
                      </span>
                      {executeStatus.configured ? (
                        <span className="chip" style={{ fontSize: 11 }}>
                          {executeStatus.connectionKind === "file" ? "file configured" : "URL configured"}
                        </span>
                      ) : (
                        <span className="chip red" style={{ fontSize: 11 }}>
                          {executeStatus.connectionKind === "file" ? "no file" : "no URL"}
                        </span>
                      )}
                      {executeStatus.installed ? (
                        <span className="chip" style={{ fontSize: 11 }}>{executeStatus.packageName} ready</span>
                      ) : (
                        <>
                          <span className="chip red" style={{ fontSize: 11 }}>{executeStatus.packageName} missing</span>
                          {executeStatus.canInstallFromStudio && (
                            <button
                              className="btn ghost sm"
                              disabled={busy.has("install-driver")}
                              onClick={() => void handleInstallExecuteDriver()}
                              style={{ fontSize: 11 }}
                            >
                              {busy.has("install-driver") ? <Loader2 size={12} className="animate-spin" /> : null}
                              Install {executeStatus.packageName}
                            </button>
                          )}
                          {!executeStatus.canInstallFromStudio && executeStatus.manualInstallReason && (
                            <span className="muted" style={{ fontSize: 11 }}>{executeStatus.installCommand}</span>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <button
                      className="btn primary"
                      disabled={busy.has("execute") || !askResult.sql || (executeStatus !== null && (!executeStatus.configured || !executeStatus.installed))}
                      onClick={() => void handleExecute()}
                    >
                      {busy.has("execute") ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                      Execute Query
                    </button>
                    {executeMessage && <InlineStatus status={executeMessage} />}
                  </div>
                </div>

                <GetTheCodePanel />

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

                {askResult.usage && (
                  <section style={{ padding: "var(--pad-y) var(--pad-x)", borderTop: "1px solid var(--border)" }}>
                    <UsageSummary title="Token usage" usage={askResult.usage} />
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

type GuardrailExplain = {
  statementKind: string;
  checksVerified: readonly string[];
  remediationNote: string;
};

function isGuardrailExplain(value: unknown): value is GuardrailExplain {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.statementKind === "string" &&
    Array.isArray(v.checksVerified) &&
    v.checksVerified.every((c) => typeof c === "string") &&
    typeof v.remediationNote === "string"
  );
}

function formatCheckLabel(check: string): string {
  return check.replace(/_/g, " ");
}

function ExplainSection({ explain }: { explain: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" className="collapsible-btn" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Explain
      </button>
      {open && (
        isGuardrailExplain(explain) ? (
          <div style={{ display: "grid", gap: 8, fontSize: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="muted" style={{ fontWeight: 600 }}>Statement kind</span>
              <span className="chip">{explain.statementKind}</span>
            </div>
            <div style={{ display: "grid", gap: 4 }}>
              <span className="muted" style={{ fontWeight: 600 }}>Checks verified</span>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
                {explain.checksVerified.map((check) => (
                  <li key={check} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Check size={13} style={{ color: "var(--green-500)", flexShrink: 0 }} />
                    {formatCheckLabel(check)}
                  </li>
                ))}
              </ul>
            </div>
            <p className="muted" style={{ margin: 0, fontStyle: "italic" }}>{explain.remediationNote}</p>
          </div>
        ) : (
          <pre className="plain-block">{formatUnknown(explain)}</pre>
        )
      )}
    </div>
  );
}
