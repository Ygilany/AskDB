import { useEffect, useState } from "react";
import { Hexagon, Loader2, RotateCcw, Save } from "lucide-react";
import type { V2Concept } from "@askdb/core";
import { useWorkspace } from "../../contexts/workspace-context";
import { Badge, Field, Input, ListInput, Textarea } from "../../components/ui";
import { StatusBanner } from "../../components/common/StatusBanner";
import { EmptyText } from "../../components/common/EmptyText";

export function ConceptsPage() {
  const { workspace, tables, handleSaveConcepts, saveStatus, busy } = useWorkspace();

  if (!workspace) return null;

  return (
    <main className="main-pane">
      <ConceptsEditor
        concepts={workspace.concepts}
        tableIds={tables.map((t) => t.physical.id)}
        onSave={handleSaveConcepts}
        saveStatus={saveStatus}
        busy={busy}
      />
    </main>
  );
}

function ConceptsEditor({
  concepts,
  tableIds,
  onSave,
  saveStatus,
  busy,
}: {
  concepts: V2Concept[];
  tableIds: string[];
  onSave: (concepts: V2Concept[]) => Promise<void>;
  saveStatus: ReturnType<typeof useWorkspace>["saveStatus"];
  busy: Set<string>;
}) {
  const [draft, setDraft] = useState<V2Concept[]>(() => clone(concepts));
  const [addOpen, setAddOpen] = useState(false);
  const [addDraft, setAddDraft] = useState<Partial<V2Concept>>({});

  useEffect(() => {
    setDraft(clone(concepts));
  }, [concepts]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(concepts);

  function updateConcept(index: number, updater: (c: V2Concept) => V2Concept) {
    setDraft((current) => current.map((c, i) => (i === index ? updater(clone(c)) : c)));
  }

  function removeConcept(index: number) {
    setDraft((current) => current.filter((_, i) => i !== index));
  }

  function commitAdd() {
    if (!addDraft.id?.trim() || !addDraft.label?.trim()) return;
    const concept: V2Concept = {
      id: addDraft.id.trim(),
      label: addDraft.label.trim(),
      ...(addDraft.synonyms?.length ? { synonyms: addDraft.synonyms } : {}),
      ...(addDraft.links?.length ? { links: addDraft.links } : {}),
      ...(addDraft.description?.trim() ? { description: addDraft.description.trim() } : {}),
    };
    setDraft((current) => [...current, concept]);
    setAddDraft({});
    setAddOpen(false);
  }

  return (
    <>
      <div className="main-hd">
        <div className="main-title">
          <h1><Hexagon size={18} style={{ display: "inline", marginRight: 8 }} />Concepts</h1>
          <div className="main-sub">Cross-table domain vocabulary for NL→SQL grounding</div>
        </div>
        <div className="main-actions">
          <button
            className="btn"
            onClick={() => setDraft(clone(concepts))}
            disabled={!dirty || busy.has("save-concepts")}
          >
            <RotateCcw size={14} /> Revert
          </button>
          <button
            className="btn primary"
            onClick={() => void onSave(draft)}
            disabled={!dirty || busy.has("save-concepts")}
          >
            {busy.has("save-concepts") ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save
          </button>
        </div>
      </div>

      {saveStatus && <StatusBanner status={saveStatus} />}

      <div className="main-body">
        <div className="stack" style={{ padding: "var(--pad-y) var(--pad-x)" }}>
          <section className="card">
            <div className="card-hd">
              <h3>What are concepts?</h3>
            </div>
            <div className="card-bd">
              <p className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
                Concepts map business vocabulary to your physical schema so the AI can translate natural language into correct SQL.
                Each concept has a canonical label, synonyms users might say, links to the tables or columns that back it, and an optional description of how it is computed.
              </p>
            </div>
          </section>

          <section className="card">
            <div className="card-hd">
              <h3>Concepts ({draft.length})</h3>
              <button className="btn sm" onClick={() => setAddOpen((o) => !o)}>
                {addOpen ? "Cancel" : "+ Add concept"}
              </button>
            </div>
            <div className="card-bd">
              <div style={{ display: "grid", gap: 16 }}>
                {addOpen && (
                  <div style={{ border: "1px dashed var(--border)", borderRadius: "var(--radius)", padding: 16 }}>
                    <p className="muted" style={{ fontSize: 11, fontWeight: 600, marginBottom: 12 }}>New concept</p>
                    <div style={{ display: "grid", gap: 12 }}>
                      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
                        <Field label="ID" description='Unique identifier, e.g. "concept:revenue"'>
                          <Input
                            value={addDraft.id ?? ""}
                            placeholder="concept:revenue"
                            onChange={(e) => setAddDraft((d) => ({ ...d, id: e.target.value }))}
                          />
                        </Field>
                        <Field label="Label" description='Human-readable name, e.g. "Revenue"'>
                          <Input
                            value={addDraft.label ?? ""}
                            placeholder="Revenue"
                            onChange={(e) => setAddDraft((d) => ({ ...d, label: e.target.value }))}
                          />
                        </Field>
                      </div>
                      <Field label="Synonyms" description='Comma-separated terms users might say'>
                        <ListInput
                          value={addDraft.synonyms}
                          onChange={(v) => setAddDraft((d) => ({ ...d, synonyms: v }))}
                        />
                      </Field>
                      <Field label="Links" description={`Comma-separated table or column IDs${tableIds.length ? `, e.g. "${tableIds[0]}"` : ""}`}>
                        <ListInput
                          value={addDraft.links}
                          onChange={(v) => setAddDraft((d) => ({ ...d, links: v }))}
                        />
                      </Field>
                      <Field label="Description" description="How this concept is computed or what it means">
                        <Textarea
                          value={addDraft.description ?? ""}
                          placeholder="Sum of orders.total_amount where status = 'paid', expressed in cents."
                          onChange={(e) => setAddDraft((d) => ({ ...d, description: e.target.value }))}
                        />
                      </Field>
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button
                          className="btn primary"
                          onClick={commitAdd}
                          disabled={!addDraft.id?.trim() || !addDraft.label?.trim()}
                        >
                          Add concept
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {draft.length === 0 && !addOpen && (
                  <EmptyText text='No concepts defined yet. Click "Add concept" to create your first one.' />
                )}

                {draft.map((concept, index) => (
                  <ConceptRow
                    key={`${concept.id}-${index}`}
                    concept={concept}
                    tableIds={tableIds}
                    onChange={(updater) => updateConcept(index, updater)}
                    onRemove={() => removeConcept(index)}
                  />
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function ConceptRow({
  concept,
  tableIds,
  onChange,
  onRemove,
}: {
  concept: V2Concept;
  tableIds: string[];
  onChange: (updater: (c: V2Concept) => V2Concept) => void;
  onRemove: () => void;
}) {
  return (
    <section className="column-row">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600 }}>{concept.label}</h4>
          <Badge variant="outline">{concept.id}</Badge>
        </div>
        <button className="btn ghost sm" onClick={onRemove} title="Remove concept">×</button>
      </div>
      <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <Field label="ID" description='Unique identifier'>
            <Input value={concept.id} onChange={(e) => onChange((c) => ({ ...c, id: e.target.value }))} />
          </Field>
          <Field label="Label" description="Human-readable name">
            <Input value={concept.label} onChange={(e) => onChange((c) => ({ ...c, label: e.target.value }))} />
          </Field>
        </div>
        <Field label="Synonyms" description="Comma-separated alternative terms">
          <ListInput
            value={concept.synonyms}
            onChange={(v) => onChange((c) => ({ ...c, synonyms: v.length ? v : undefined }))}
          />
        </Field>
        <Field label="Links" description={`Comma-separated table or column IDs${tableIds.length ? `, e.g. "${tableIds[0]}"` : ""}`}>
          <ListInput
            value={concept.links}
            onChange={(v) => onChange((c) => ({ ...c, links: v.length ? v : undefined }))}
          />
        </Field>
        <Field label="Description" description="How this concept is computed or what it means">
          <Textarea
            value={concept.description ?? ""}
            onChange={(e) => onChange((c) => ({ ...c, description: e.target.value || undefined }))}
          />
        </Field>
      </div>
    </section>
  );
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
