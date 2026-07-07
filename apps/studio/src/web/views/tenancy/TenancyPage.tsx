import { useCallback, useReducer, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Pencil,
  RotateCcw,
  Save,
  Settings,
  Shield,
  Sparkles,
} from "lucide-react";
import type { ReactNode } from "react";
import type { NormalizedTenantPolicy, TenantPolicyFrontmatter } from "@askdb/core";
import { useWorkspace } from "../../contexts/workspace-context";
import { useRag } from "../../contexts/rag-context";
import { Badge } from "../../components/ui/badge";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { StatusBanner } from "../../components/common/StatusBanner";
import type { StatusMessage } from "../../contexts/workspace-context";
import type { StudioTableDto } from "@/shared/api";

export function TenancyPage() {
  const {
    workspace,
    tables,
    handleSaveTenantPolicy,
    handleSuggestTenantPolicy,
    saveStatus,
    busy,
  } = useWorkspace();
  const { refreshRagStatus } = useRag();
  const [editingSavedPolicy, setEditingSavedPolicy] = useState(false);

  const onSaveTenantPolicy = useCallback(async (frontmatter: TenantPolicyFrontmatter, body?: string) => {
    const saved = await handleSaveTenantPolicy(frontmatter, body);
    if (saved) void refreshRagStatus();
    return saved;
  }, [handleSaveTenantPolicy, refreshRagStatus]);

  if (!workspace) return null;

  const tenantPolicy = workspace.tenantPolicy ?? null;

  if (!tenantPolicy) {
    return (
      <main className="main-pane">
        <TenancyCreateForm
          tables={tables}
          schemaId={workspace.schemaId}
          aiConfigured={workspace.aiConfigured}
          busy={busy}
          onSave={onSaveTenantPolicy}
          onSuggest={handleSuggestTenantPolicy}
          saveStatus={saveStatus}
        />
      </main>
    );
  }

  if (editingSavedPolicy) {
    return (
      <main className="main-pane">
        <TenancyEditSavedPolicy
          key={tenantPolicy.schemaId}
          tenantPolicy={tenantPolicy}
          tables={tables}
          busy={busy}
          saveStatus={saveStatus}
          onSave={async (frontmatter, body) => {
            const saved = await onSaveTenantPolicy(frontmatter, body);
            if (saved) setEditingSavedPolicy(false);
            return saved;
          }}
          onCancel={() => setEditingSavedPolicy(false)}
        />
      </main>
    );
  }

  return (
    <main className="main-pane">
      <TenancyView
        tenantPolicy={tenantPolicy}
        onEdit={() => setEditingSavedPolicy(true)}
      />
    </main>
  );
}

function TenancyView({
  tenantPolicy,
  onEdit,
}: {
  tenantPolicy: NormalizedTenantPolicy;
  onEdit: () => void;
}) {
  const coverageByClassification = tenantPolicy.coverage.reduce(
    (acc, entry) => {
      acc[entry.classification] = (acc[entry.classification] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const totalTables = tenantPolicy.coverage.length;
  const coveredTables = totalTables - (coverageByClassification["unknown"] ?? 0);
  const coveragePct = totalTables > 0 ? Math.round((coveredTables / totalTables) * 100) : 0;

  return (
    <>
      <div className="main-hd">
        <div className="main-title">
          <h1><Shield size={18} style={{ display: "inline", marginRight: 8 }} />Multi-Tenancy</h1>
          <div className="main-sub">
            Schema: {tenantPolicy.schemaId} · {coveragePct}% table coverage ({coveredTables}/{totalTables})
            <Badge variant={tenantPolicy.enforcement === "strict" ? "danger" : "warning"} style={{ marginLeft: 8 }}>
              {tenantPolicy.enforcement}
            </Badge>
          </div>
        </div>
        <div className="main-actions">
          <button type="button" className="btn" onClick={onEdit}>
            <Pencil size={14} /> Edit
          </button>
        </div>
      </div>
      <div className="main-body">
        <div className="stack" style={{ padding: "var(--pad-y) var(--pad-x)" }}>
          <CollapsibleSection title="Coverage">
            <div className="grid-4">
              <CoverageStat label="Root" count={coverageByClassification["root"] ?? 0} variant="primary" />
              <CoverageStat label="Scoped" count={coverageByClassification["scoped"] ?? 0} variant="primary" />
              <CoverageStat label="Global" count={coverageByClassification["global"] ?? 0} variant="secondary" />
              <CoverageStat label="Unknown" count={coverageByClassification["unknown"] ?? 0} variant="warning" />
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Tenant Roots" count={tenantPolicy.roots.length}>
            <div style={{ display: "grid", gap: 8 }}>
              {tenantPolicy.roots.map((root) => (
                <div className="card" key={root.id} style={{ padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div>
                      <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{root.id}</span>
                      <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{root.label}</span>
                    </div>
                    <Badge variant="outline">col: {root.tenantIdColumn}</Badge>
                  </div>
                  {root.parent && (
                    <p className="muted tiny" style={{ marginTop: 4 }}>
                      Parent: <code>{root.parent.root}</code> via <code>{root.parent.foreignKey}</code>
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CollapsibleSection>

          {tenantPolicy.hierarchy.length > 0 && (
            <CollapsibleSection title="Hierarchy Edges" count={tenantPolicy.hierarchy.length}>
              <div style={{ display: "grid", gap: 8 }}>
                {tenantPolicy.hierarchy.map((edge) => (
                  <div className="card" key={`${edge.parent}-${edge.child}`} style={{ padding: 12, fontSize: 13 }}>
                    <code>{edge.parent}</code>
                    <span className="muted" style={{ margin: "0 8px" }}>&rarr;</span>
                    <code>{edge.child}</code>
                    <div className="muted tiny" style={{ marginTop: 4 }}>FK: {edge.foreignKey}</div>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {tenantPolicy.scopedTables.length > 0 && (
            <CollapsibleSection title="Scoped Tables" count={tenantPolicy.scopedTables.length} defaultOpen={false}>
              <div style={{ display: "grid", gap: 8 }}>
                {tenantPolicy.scopedTables.map((scoped) => (
                  <div className="card" key={scoped.id} style={{ padding: 12 }}>
                    <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{scoped.id}</span>
                    <div style={{ marginTop: 4, display: "grid", gap: 4 }}>
                      {scoped.scopeThrough.map((scope, si) => (
                        <p className="muted tiny" key={si}>
                          via <Badge variant="outline">{scope.root}</Badge>{" "}
                          {"column" in scope
                            ? <span>column <code>{scope.column}</code></span>
                            : <span>join {scope.join.map((j) => `${j.from} -> ${j.to}`).join(", ")}</span>}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {tenantPolicy.polymorphicTables.length > 0 && (
            <CollapsibleSection title="Polymorphic Tables" count={tenantPolicy.polymorphicTables.length} defaultOpen={false}>
              <div style={{ display: "grid", gap: 8 }}>
                {tenantPolicy.polymorphicTables.map((poly) => (
                  <div className="card" key={poly.id} style={{ padding: 12 }}>
                    <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{poly.id}</span>
                    <p className="muted tiny" style={{ marginTop: 4 }}>
                      Type: <code>{poly.typeColumn}</code> · ID: <code>{poly.idColumn}</code>
                    </p>
                    <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {Object.entries(poly.mapping).map(([typeValue, targetTable]) => (
                        <Badge variant="outline" key={typeValue}>{typeValue} &rarr; {targetTable}</Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {tenantPolicy.globalTables.length > 0 && (
            <CollapsibleSection title="Global Tables" count={tenantPolicy.globalTables.length} defaultOpen={false}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {tenantPolicy.globalTables.map((tableId) => (
                  <Badge variant="secondary" key={tableId}>{tableId}</Badge>
                ))}
              </div>
            </CollapsibleSection>
          )}

          <CollapsibleSection title="Table Coverage" count={tenantPolicy.coverage.length} defaultOpen={false}>
            <div className="card">
              <div className="card-bd tight">
                <table className="tbl">
                  <thead>
                    <tr><th>Table</th><th>Classification</th><th>Scope Roots</th></tr>
                  </thead>
                  <tbody>
                    {tenantPolicy.coverage.map((entry) => (
                      <tr key={entry.tableId}>
                        <td><span className="mono">{entry.tableId}</span></td>
                        <td>
                          <Badge variant={
                            entry.classification === "unknown" ? "warning"
                              : entry.classification === "global" ? "secondary" : "outline"
                          }>
                            {entry.classification}
                          </Badge>
                        </td>
                        <td className="muted tiny">{entry.scopeRoots?.join(", ") ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </CollapsibleSection>

          {tenantPolicy.warnings.length > 0 && (
            <CollapsibleSection title="Policy Warnings" count={tenantPolicy.warnings.length}>
              <div style={{ display: "grid", gap: 8 }}>
                {tenantPolicy.warnings.map((warning) => (
                  <pre className="warning-block" key={String(warning)}>{formatUnknown(warning)}</pre>
                ))}
              </div>
            </CollapsibleSection>
          )}
        </div>
      </div>
    </>
  );
}

function TenancyEditSavedPolicy({
  tenantPolicy,
  tables,
  busy,
  saveStatus,
  onSave,
  onCancel,
}: {
  tenantPolicy: NormalizedTenantPolicy;
  tables: StudioTableDto[];
  busy: Set<string>;
  saveStatus: StatusMessage | null;
  onSave: (frontmatter: TenantPolicyFrontmatter, body?: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [frontmatter, setFrontmatter] = useState<TenantPolicyFrontmatter>(() => frontmatterFromTenantPolicy(tenantPolicy));
  const [body, setBody] = useState(() => tenantPolicy.body);

  return (
    <TenancyReviewDraft
      tables={tables}
      frontmatter={frontmatter}
      body={body}
      busy={busy}
      saveStatus={saveStatus}
      onFrontmatterChange={setFrontmatter}
      onBodyChange={setBody}
      onConfirm={() => void onSave(frontmatter, body || undefined)}
      onBack={onCancel}
      title="Edit Tenant Policy"
      backLabel="Cancel"
      confirmLabel="Save Changes"
      badgeLabel="Saved"
    />
  );
}

type CreateFormState = {
  mode: "choose" | "manual" | "review";
  draftStatus: StatusMessage | null;
  draftFrontmatter: TenantPolicyFrontmatter | null;
  draftBody: string;
  enforcement: "strict" | "warn";
  rootTableId: string;
  rootTenantIdColumn: string;
  rootLabel: string;
  globalTableIds: string[];
};

type CreateFormAction =
  | { type: "set_mode"; payload: "choose" | "manual" | "review" }
  | { type: "set_draftStatus"; payload: StatusMessage | null }
  | { type: "set_draftFrontmatter"; payload: TenantPolicyFrontmatter }
  | { type: "set_draftBody"; payload: string }
  | { type: "set_enforcement"; payload: "strict" | "warn" }
  | { type: "set_rootTenantIdColumn"; payload: string }
  | { type: "set_rootLabel"; payload: string }
  | { type: "select_root_table"; tableId: string; label: string }
  | { type: "toggle_global_table"; tableId: string; checked: boolean }
  | { type: "ai_draft_complete"; frontmatter: TenantPolicyFrontmatter; body: string }
  | { type: "manual_to_review"; frontmatter: TenantPolicyFrontmatter; body: string };

function createFormReducer(state: CreateFormState, action: CreateFormAction): CreateFormState {
  switch (action.type) {
    case "set_mode": return { ...state, mode: action.payload };
    case "set_draftStatus": return { ...state, draftStatus: action.payload };
    case "set_draftFrontmatter": return { ...state, draftFrontmatter: action.payload };
    case "set_draftBody": return { ...state, draftBody: action.payload };
    case "set_enforcement": return { ...state, enforcement: action.payload };
    case "set_rootTenantIdColumn": return { ...state, rootTenantIdColumn: action.payload };
    case "set_rootLabel": return { ...state, rootLabel: action.payload };
    case "select_root_table": return {
      ...state,
      rootTableId: action.tableId,
      rootLabel: action.label,
      rootTenantIdColumn: "",
    };
    case "toggle_global_table": return {
      ...state,
      globalTableIds: action.checked
        ? [...state.globalTableIds, action.tableId]
        : state.globalTableIds.filter((id) => id !== action.tableId),
    };
    case "ai_draft_complete": return {
      ...state,
      draftFrontmatter: action.frontmatter,
      draftBody: action.body,
      mode: "review",
      draftStatus: { kind: "success", text: "AI draft ready for review." },
    };
    case "manual_to_review": return {
      ...state,
      draftFrontmatter: action.frontmatter,
      draftBody: action.body,
      mode: "review",
    };
  }
}

const initialCreateFormState: CreateFormState = {
  mode: "choose",
  draftStatus: null,
  draftFrontmatter: null,
  draftBody: "",
  enforcement: "strict",
  rootTableId: "",
  rootTenantIdColumn: "",
  rootLabel: "",
  globalTableIds: [],
};

function TenancyCreateForm({
  tables,
  schemaId,
  aiConfigured,
  busy,
  onSave,
  onSuggest,
  saveStatus,
}: {
  tables: StudioTableDto[];
  schemaId: string;
  aiConfigured: boolean;
  busy: Set<string>;
  onSave: (frontmatter: TenantPolicyFrontmatter, body?: string) => Promise<void>;
  onSuggest: () => Promise<{ frontmatter: TenantPolicyFrontmatter; body: string }>;
  saveStatus: StatusMessage | null;
}) {
  const [state, dispatch] = useReducer(createFormReducer, initialCreateFormState);
  const { mode, draftStatus, draftFrontmatter, draftBody, enforcement, rootTableId, rootTenantIdColumn, rootLabel, globalTableIds } = state;

  const selectedRootTable = tables.find((t) => t.physical.id === rootTableId);
  const rootColumns = selectedRootTable?.physical.columns ?? [];

  async function handleDraftWithAi() {
    dispatch({ type: "set_draftStatus", payload: { kind: "loading", text: "Analyzing schema and drafting tenant policy..." } });
    try {
      const result = await onSuggest();
      dispatch({ type: "ai_draft_complete", frontmatter: result.frontmatter, body: result.body });
    } catch (error) {
      dispatch({ type: "set_draftStatus", payload: { kind: "error", text: error instanceof Error ? error.message : String(error) } });
    }
  }

  function handleManualToReview() {
    if (!rootTableId || !rootTenantIdColumn || !rootLabel.trim()) return;
    const frontmatter: TenantPolicyFrontmatter = {
      schemaId,
      enforcement,
      roots: [{ id: rootTableId, tenantIdColumn: rootTenantIdColumn, label: rootLabel.trim() }],
      ...(globalTableIds.length > 0 ? { globalTables: globalTableIds } : {}),
    };
    dispatch({ type: "manual_to_review", frontmatter, body: "# Tenant Policy\n\n\n\n## Hierarchy\n\n\n\n## Scope Rules\n\n\n\n## Sensitive Interactions\n\n" });
  }

  function handleConfirm() {
    if (!draftFrontmatter) return;
    void onSave(draftFrontmatter, draftBody || undefined);
  }

  const manualCanProceed = rootTableId && rootTenantIdColumn && rootLabel.trim();

  if (mode === "choose") {
    return (
      <>
        <div className="main-hd">
          <div className="main-title">
            <h1><Shield size={18} style={{ display: "inline", marginRight: 8 }} />Enable Multi-Tenancy</h1>
            <div className="main-sub">Configure tenant isolation for your schema</div>
          </div>
        </div>
        {draftStatus && <StatusBanner status={draftStatus} />}
        <div className="main-body">
          <div className="stack" style={{ padding: "var(--pad-y) var(--pad-x)" }}>
            <div className="grid-2">
              <button
                type="button"
                className="card"
                style={{ cursor: "pointer", textAlign: "left", border: "2px dashed var(--border)" }}
                disabled={!aiConfigured || draftStatus?.kind === "loading"}
                onClick={() => void handleDraftWithAi()}
              >
                <div className="card-bd">
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    {draftStatus?.kind === "loading"
                      ? <Loader2 size={20} className="animate-spin" style={{ color: "var(--red-600)" }} />
                      : <Sparkles size={20} style={{ color: "var(--red-600)" }} />}
                    <h3 style={{ fontWeight: 600 }}>Draft with AI</h3>
                  </div>
                  <p className="muted" style={{ fontSize: 13 }}>
                    {draftStatus?.kind === "loading"
                      ? "Analyzing your schema..."
                      : "Let AI analyze your schema and propose a complete tenant policy. You will review before saving."}
                  </p>
                  {!aiConfigured && (
                    <p style={{ marginTop: 8, fontSize: 12, color: "var(--red-600)" }}>
                      Configure an AI provider to use this option.
                    </p>
                  )}
                </div>
              </button>
              <button
                type="button"
                className="card"
                style={{ cursor: "pointer", textAlign: "left", border: "2px dashed var(--border)" }}
                onClick={() => dispatch({ type: "set_mode", payload: "manual" })}
              >
                <div className="card-bd">
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <Settings size={20} style={{ color: "var(--ink-400)" }} />
                    <h3 style={{ fontWeight: 600 }}>Configure manually</h3>
                  </div>
                  <p className="muted" style={{ fontSize: 13 }}>
                    Pick the tenant root table and column yourself, then review before saving.
                  </p>
                </div>
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (mode === "manual") {
    return (
      <>
        <div className="main-hd">
          <div className="main-title">
            <h1><Shield size={18} style={{ display: "inline", marginRight: 8 }} />Manual Configuration</h1>
            <div className="main-sub">Configure the basics, then review before saving</div>
          </div>
          <div className="main-actions">
            <button type="button" className="btn" onClick={() => dispatch({ type: "set_mode", payload: "choose" })}>Back</button>
          </div>
        </div>
        <div className="main-body">
          <div className="stack" style={{ padding: "var(--pad-y) var(--pad-x)" }}>
            <section className="card">
              <div className="card-hd"><h3>Tenant Root</h3></div>
              <div className="card-bd">
                <div style={{ display: "grid", gap: 16 }}>
                  <Field label="Root table" description="The table whose rows represent tenants.">
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={rootTableId}
                      onChange={(e) => {
                        const tableId = e.target.value;
                        const table = tables.find((t) => t.physical.id === tableId);
                        dispatch({ type: "select_root_table", tableId, label: table?.physical.name ?? "" });
                      }}
                    >
                      <option value="">Select a table...</option>
                      {tables.map((t) => (
                        <option key={t.physical.id} value={t.physical.id}>{t.physical.schema}.{t.physical.name}</option>
                      ))}
                    </select>
                  </Field>
                  {rootTableId && (
                    <Field label="Tenant ID column" description="The column that uniquely identifies a tenant.">
                      <select
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={rootTenantIdColumn}
                        onChange={(e) => dispatch({ type: "set_rootTenantIdColumn", payload: e.target.value })}
                      >
                        <option value="">Select a column...</option>
                        {rootColumns.map((col) => (
                          <option key={col.id} value={col.name}>{col.name} ({col.type}{col.primaryKey ? ", PK" : ""})</option>
                        ))}
                      </select>
                    </Field>
                  )}
                  <Field label="Label" description='e.g. "Organization" or "Company"'>
                    <Input value={rootLabel} placeholder="e.g. Organization" onChange={(e) => dispatch({ type: "set_rootLabel", payload: e.target.value })} />
                  </Field>
                </div>
              </div>
            </section>

            <section className="card">
              <div className="card-hd"><h3>Enforcement Mode</h3></div>
              <div className="card-bd">
                <fieldset className="toggle-seg">
                  <button type="button" className={enforcement === "strict" ? "active" : ""} onClick={() => dispatch({ type: "set_enforcement", payload: "strict" })}>Strict</button>
                  <button type="button" className={enforcement === "warn" ? "active" : ""} onClick={() => dispatch({ type: "set_enforcement", payload: "warn" })}>Warn</button>
                </fieldset>
                <p className="muted tiny" style={{ marginTop: 8 }}>
                  {enforcement === "strict"
                    ? "Queries touching unknown (unscoped) tables will be rejected."
                    : "Queries touching unknown tables will succeed but emit warnings."}
                </p>
              </div>
            </section>

            <section className="card">
              <div className="card-hd"><h3>Global Tables (optional)</h3></div>
              <div className="card-bd">
                <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
                  Global tables are shared across all tenants and never filtered.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {tables.map((t) => {
                    if (t.physical.id === rootTableId) return null;
                    const checked = globalTableIds.includes(t.physical.id);
                    return (
                      <label className="chunk-toggle" key={t.physical.id}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => dispatch({ type: "toggle_global_table", tableId: t.physical.id, checked: e.target.checked })}
                        />
                        {t.physical.schema}.{t.physical.name}
                      </label>
                    );
                  })}
                </div>
              </div>
            </section>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" className="btn primary" onClick={handleManualToReview} disabled={!manualCanProceed}>
                <ChevronRight size={14} /> Review & Confirm
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <TenancyReviewDraft
      tables={tables}
      frontmatter={draftFrontmatter!}
      body={draftBody}
      busy={busy}
      saveStatus={saveStatus}
      onFrontmatterChange={(fm) => dispatch({ type: "set_draftFrontmatter", payload: fm })}
      onBodyChange={(b) => dispatch({ type: "set_draftBody", payload: b })}
      onConfirm={handleConfirm}
      onBack={() => dispatch({ type: "set_mode", payload: "choose" })}
    />
  );
}

function TenancyReviewDraft({
  tables,
  frontmatter,
  body,
  busy,
  saveStatus,
  onFrontmatterChange,
  onBodyChange,
  onConfirm,
  onBack,
  title = "Review Tenant Policy",
  backLabel = "Start Over",
  confirmLabel = "Confirm & Save",
  badgeLabel = "Draft",
}: {
  tables: StudioTableDto[];
  frontmatter: TenantPolicyFrontmatter;
  body: string;
  busy: Set<string>;
  saveStatus: StatusMessage | null;
  onFrontmatterChange: (fm: TenantPolicyFrontmatter) => void;
  onBodyChange: (body: string) => void;
  onConfirm: () => void;
  onBack: () => void;
  title?: string;
  backLabel?: string;
  confirmLabel?: string;
  badgeLabel?: string;
}) {
  function updateEnforcement(e: "strict" | "warn") {
    onFrontmatterChange({ ...frontmatter, enforcement: e });
  }
  function updateRootLabel(index: number, label: string) {
    const roots = [...frontmatter.roots];
    roots[index] = { ...roots[index], label };
    onFrontmatterChange({ ...frontmatter, roots });
  }
  function removeRoot(index: number) {
    const roots = frontmatter.roots.filter((_, i) => i !== index);
    if (roots.length === 0) return;
    onFrontmatterChange({ ...frontmatter, roots });
  }
  function removeHierarchyEdge(index: number) {
    const h = (frontmatter.hierarchy ?? []).filter((_, i) => i !== index);
    onFrontmatterChange({ ...frontmatter, hierarchy: h.length > 0 ? h : undefined });
  }
  function removeScopedTable(index: number) {
    const s = (frontmatter.scopedTables ?? []).filter((_, i) => i !== index);
    onFrontmatterChange({ ...frontmatter, scopedTables: s.length > 0 ? s : undefined });
  }
  function removePolymorphicTable(index: number) {
    const p = (frontmatter.polymorphicTables ?? []).filter((_, i) => i !== index);
    onFrontmatterChange({ ...frontmatter, polymorphicTables: p.length > 0 ? p : undefined });
  }
  function toggleGlobalTable(tableId: string) {
    const current = frontmatter.globalTables ?? [];
    const next = current.includes(tableId) ? current.filter((id) => id !== tableId) : [...current, tableId];
    onFrontmatterChange({ ...frontmatter, globalTables: next.length > 0 ? next : undefined });
  }

  const rootIds = new Set(frontmatter.roots.map((r) => r.id));
  const scopedIds = new Set((frontmatter.scopedTables ?? []).map((s) => s.id));
  const polyIds = new Set((frontmatter.polymorphicTables ?? []).map((p) => p.id));
  const globalIds = new Set(frontmatter.globalTables ?? []);

  return (
    <>
      <div className="main-hd">
        <div className="main-title">
          <h1><Shield size={18} style={{ display: "inline", marginRight: 8 }} />{title}</h1>
          <div className="main-sub"><Badge variant="warning">{badgeLabel}</Badge></div>
        </div>
        <div className="main-actions">
          <button type="button" className="btn" onClick={onBack}><RotateCcw size={14} /> {backLabel}</button>
          <button
            type="button"
            className="btn primary"
            onClick={onConfirm}
            disabled={busy.has("save-tenant-policy") || frontmatter.roots.length === 0}
          >
            {busy.has("save-tenant-policy") ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {confirmLabel}
          </button>
        </div>
      </div>

      {saveStatus && <StatusBanner status={saveStatus} />}

      <div className="main-body">
        <div className="stack" style={{ padding: "var(--pad-y) var(--pad-x)" }}>
          <section className="card">
            <div className="card-hd"><h3>Enforcement Mode</h3></div>
            <div className="card-bd">
              <fieldset className="toggle-seg">
                <button type="button" className={frontmatter.enforcement === "strict" ? "active" : ""} onClick={() => updateEnforcement("strict")}>Strict</button>
                <button type="button" className={frontmatter.enforcement === "warn" ? "active" : ""} onClick={() => updateEnforcement("warn")}>Warn</button>
              </fieldset>
              <p className="muted tiny" style={{ marginTop: 8 }}>
                {frontmatter.enforcement === "strict"
                  ? "Queries touching unknown (unscoped) tables will be rejected."
                  : "Queries touching unknown tables will succeed but emit warnings."}
              </p>
            </div>
          </section>

          <section className="card">
            <div className="card-hd"><h3>Tenant Roots ({frontmatter.roots.length})</h3></div>
            <div className="card-bd">
              <div style={{ display: "grid", gap: 12 }}>
                {frontmatter.roots.map((root, i) => (
                  <div key={root.id} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <div>
                        <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{root.id}</span>
                        <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
                          <Badge variant="outline">col: {root.tenantIdColumn}</Badge>
                          {root.parent && <Badge variant="outline">parent: {root.parent.root} via {root.parent.foreignKey}</Badge>}
                        </div>
                      </div>
                      {frontmatter.roots.length > 1 && (
                        <button type="button" className="btn ghost sm" onClick={() => removeRoot(i)} title="Remove root">×</button>
                      )}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <Field label="Label" description="Human-readable name for this tenant root.">
                        <Input value={root.label} onChange={(e) => updateRootLabel(i, e.target.value)} />
                      </Field>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {(frontmatter.hierarchy ?? []).length > 0 && (
            <section className="card">
              <div className="card-hd"><h3>Hierarchy Edges ({frontmatter.hierarchy!.length})</h3></div>
              <div className="card-bd">
                <div style={{ display: "grid", gap: 8 }}>
                  {frontmatter.hierarchy!.map((edge) => (
                    <div key={`${edge.parent}-${edge.child}`} className="policy-edge-card">
                      <div>
                        <code>{edge.parent}</code>
                        <span className="muted" style={{ margin: "0 8px" }}>&rarr;</span>
                        <code>{edge.child}</code>
                        <div className="muted tiny" style={{ marginTop: 4 }}>FK: {edge.foreignKey}</div>
                      </div>
                      <button type="button" className="btn ghost sm" onClick={() => removeHierarchyEdge(i)} title="Remove">×</button>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {(frontmatter.scopedTables ?? []).length > 0 && (
            <section className="card">
              <div className="card-hd"><h3>Scoped Tables ({frontmatter.scopedTables!.length})</h3></div>
              <div className="card-bd">
                <div style={{ display: "grid", gap: 8 }}>
                  {frontmatter.scopedTables!.map((scoped, i) => (
                    <div key={scoped.id} style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 8, border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 12 }}>
                      <div>
                        <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{scoped.id}</span>
                        <div style={{ marginTop: 4, display: "grid", gap: 4 }}>
                          {scoped.scopeThrough.map((scope, si) => (
                            <p className="muted tiny" key={si}>
                              via <Badge variant="outline">{scope.root}</Badge>{" "}
                              {"column" in scope
                                ? <span>column <code>{scope.column}</code></span>
                                : <span>join {scope.join.map((j) => `${j.from} -> ${j.to}`).join(", ")}</span>}
                            </p>
                          ))}
                        </div>
                      </div>
                      <button type="button" className="btn ghost sm" onClick={() => removeScopedTable(i)} title="Remove">×</button>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {(frontmatter.polymorphicTables ?? []).length > 0 && (
            <section className="card">
              <div className="card-hd"><h3>Polymorphic Tables ({frontmatter.polymorphicTables!.length})</h3></div>
              <div className="card-bd">
                <div style={{ display: "grid", gap: 8 }}>
                  {frontmatter.polymorphicTables!.map((poly, i) => (
                    <div key={poly.id} style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 8, border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 12 }}>
                      <div>
                        <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{poly.id}</span>
                        <p className="muted tiny" style={{ marginTop: 4 }}>
                          Type: <code>{poly.typeColumn}</code> · ID: <code>{poly.idColumn}</code>
                        </p>
                        <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {Object.entries(poly.mapping).map(([tv, tt]) => (
                            <Badge variant="outline" key={tv}>{tv} &rarr; {tt}</Badge>
                          ))}
                        </div>
                      </div>
                      <button type="button" className="btn ghost sm" onClick={() => removePolymorphicTable(i)} title="Remove">×</button>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          <section className="card">
            <div className="card-hd"><h3>Global Tables</h3></div>
            <div className="card-bd">
              <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
                Global tables are shared across all tenants and never filtered.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {tables.map((t) => {
                  if (rootIds.has(t.physical.id) || scopedIds.has(t.physical.id) || polyIds.has(t.physical.id)) return null;
                  return (
                    <label className="chunk-toggle" key={t.physical.id}>
                      <input type="checkbox" checked={globalIds.has(t.physical.id)} onChange={() => toggleGlobalTable(t.physical.id)} />
                      {t.physical.schema}.{t.physical.name}
                    </label>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-hd"><h3>Documentation (body)</h3></div>
            <div className="card-bd">
              <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
                Optional markdown body explaining the tenant policy.
              </p>
              <Textarea className="min-h-48 font-mono text-xs" value={body} onChange={(e) => onBodyChange(e.target.value)} />
            </div>
          </section>

          <section className="card">
            <div className="card-hd"><h3>Frontmatter Preview</h3></div>
            <div className="card-bd">
              <pre className="plain-block" style={{ fontSize: 12 }}>{JSON.stringify(frontmatter, null, 2)}</pre>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function CollapsibleSection({
  title,
  count,
  children,
  defaultOpen = true,
}: {
  title: string;
  count?: number;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section>
      <button
        type="button"
        className="collapsible-btn"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {title}{count != null ? ` (${count})` : ""}
      </button>
      {open && children}
    </section>
  );
}

function CoverageStat({ label, count, variant }: { label: string; count: number; variant: "primary" | "secondary" | "warning" }) {
  const bg = variant === "primary" ? "var(--red-50)" : variant === "secondary" ? "var(--surface-2)" : "#fef3c7";
  return (
    <div className="card" style={{ textAlign: "center", padding: 12, background: bg }}>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{count}</div>
      <div className="muted tiny">{label}</div>
    </div>
  );
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function frontmatterFromTenantPolicy(policy: NormalizedTenantPolicy): TenantPolicyFrontmatter {
  return {
    schemaId: policy.schemaId,
    enforcement: policy.enforcement,
    roots: clone(policy.roots),
    ...(policy.hierarchy.length > 0 ? { hierarchy: clone(policy.hierarchy) } : {}),
    ...(policy.scopedTables.length > 0 ? { scopedTables: clone(policy.scopedTables) } : {}),
    ...(policy.polymorphicTables.length > 0 ? { polymorphicTables: clone(policy.polymorphicTables) } : {}),
    ...(policy.globalTables.length > 0 ? { globalTables: [...policy.globalTables] } : {}),
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
