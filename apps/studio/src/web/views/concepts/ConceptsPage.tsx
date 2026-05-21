import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Hexagon, Loader2, RotateCcw, Save, Search, Table2, X } from "lucide-react";
import type { V2Concept } from "@askdb/core";
import { useWorkspace } from "../../contexts/workspace-context";
import { Badge, Field, Input, ListInput, Textarea } from "../../components/ui";
import { StatusBanner } from "../../components/common/StatusBanner";
import { EmptyText } from "../../components/common/EmptyText";

/* ─── helpers ─── */
const CONCEPT_PREFIX = "concept:";

function stripPrefix(id: string): string {
  return id.startsWith(CONCEPT_PREFIX) ? id.slice(CONCEPT_PREFIX.length) : id;
}
function ensurePrefix(slug: string): string {
  const trimmed = slug.trim();
  if (!trimmed) return "";
  return trimmed.startsWith(CONCEPT_PREFIX) ? trimmed : CONCEPT_PREFIX + trimmed;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/* ═══════════════ Page ═══════════════ */

export function ConceptsPage() {
  const { workspace, tables, handleSaveConcepts, saveStatus, busy } = useWorkspace();

  // Build a flat list of linkable IDs (tables + columns)
  const linkOptions = useMemo(() => {
    if (!tables.length) return [];
    const opts: LinkOption[] = [];
    for (const t of tables) {
      opts.push({
        id: t.physical.id,
        label: `${t.physical.schema}.${t.physical.name}`,
        kind: "table",
      });
      for (const c of t.physical.columns) {
        opts.push({
          id: c.id,
          label: `${t.physical.schema}.${t.physical.name} → ${c.name}`,
          kind: "column",
        });
      }
    }
    return opts;
  }, [tables]);

  if (!workspace) return null;

  return (
    <main className="main-pane">
      <ConceptsEditor
        concepts={workspace.concepts}
        linkOptions={linkOptions}
        onSave={handleSaveConcepts}
        saveStatus={saveStatus}
        busy={busy}
      />
    </main>
  );
}

/* ═══════════════ Editor ═══════════════ */

function ConceptsEditor({
  concepts,
  linkOptions,
  onSave,
  saveStatus,
  busy,
}: {
  concepts: V2Concept[];
  linkOptions: LinkOption[];
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
    const id = ensurePrefix(addDraft.id ?? "");
    if (!id || !addDraft.label?.trim()) return;
    const concept: V2Concept = {
      id,
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
                        <Field label="ID" description="Unique slug (concept: prefix added automatically)">
                          <ConceptIdInput
                            value={addDraft.id ?? ""}
                            onChange={(v) => setAddDraft((d) => ({ ...d, id: v }))}
                            placeholder="revenue"
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
                      <Field label="Synonyms" description="Comma-separated terms users might say">
                        <ListInput
                          value={addDraft.synonyms}
                          onChange={(v) => setAddDraft((d) => ({ ...d, synonyms: v }))}
                        />
                      </Field>
                      <Field label="Links" description="Tables or columns this concept maps to">
                        <LinksInput
                          value={addDraft.links ?? []}
                          onChange={(v) => setAddDraft((d) => ({ ...d, links: v }))}
                          options={linkOptions}
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
                    linkOptions={linkOptions}
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

/* ═══════════════ Concept row ═══════════════ */

function ConceptRow({
  concept,
  linkOptions,
  onChange,
  onRemove,
}: {
  concept: V2Concept;
  linkOptions: LinkOption[];
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
          <Field label="ID" description="Unique slug (concept: prefix added automatically)">
            <ConceptIdInput
              value={concept.id}
              onChange={(v) => onChange((c) => ({ ...c, id: v }))}
            />
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
        <Field label="Links" description="Tables or columns this concept maps to">
          <LinksInput
            value={concept.links ?? []}
            onChange={(v) => onChange((c) => ({ ...c, links: v.length ? v : undefined }))}
            options={linkOptions}
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

/* ═══════════════ ConceptIdInput ═══════════════ */
/* Shows a fixed "concept:" prefix badge; user only types the slug */

function ConceptIdInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (fullId: string) => void;
  placeholder?: string;
}) {
  const slug = stripPrefix(value);

  return (
    <div className="concept-id-input">
      <span className="concept-id-prefix">concept:</span>
      <input
        type="text"
        className="concept-id-slug"
        value={slug}
        placeholder={placeholder ?? "my-concept"}
        onChange={(e) => {
          const raw = e.target.value.replace(/\s+/g, "-").toLowerCase();
          onChange(ensurePrefix(raw));
        }}
      />
    </div>
  );
}

/* ═══════════════ LinksInput ═══════════════ */
/* Searchable multi-select for table / column IDs */

type LinkOption = { id: string; label: string; kind: "table" | "column" };

function LinksInput({
  value,
  onChange,
  options,
}: {
  value: string[];
  onChange: (links: string[]) => void;
  options: LinkOption[];
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selectedSet = useMemo(() => new Set(value), [value]);

  const filtered = useMemo(() => {
    if (!query) return options.filter((o) => !selectedSet.has(o.id));
    const q = query.toLowerCase();
    return options.filter(
      (o) => !selectedSet.has(o.id) && (o.label.toLowerCase().includes(q) || o.id.toLowerCase().includes(q)),
    );
  }, [options, query, selectedSet]);

  const addLink = useCallback(
    (id: string) => {
      onChange([...value, id]);
      setQuery("");
      inputRef.current?.focus();
    },
    [value, onChange],
  );

  const removeLink = useCallback(
    (id: string) => {
      onChange(value.filter((v) => v !== id));
    },
    [value, onChange],
  );

  function labelFor(id: string): string {
    return options.find((o) => o.id === id)?.label ?? id;
  }

  function kindFor(id: string): string {
    return options.find((o) => o.id === id)?.kind ?? (id.includes("#") ? "column" : "table");
  }

  return (
    <div className="links-input" ref={wrapperRef}>
      {/* Selected chips */}
      {value.length > 0 && (
        <div className="links-chips">
          {value.map((id) => (
            <span key={id} className={`links-chip ${kindFor(id)}`} title={id}>
              <Table2 size={10} />
              <span className="links-chip-label">{labelFor(id)}</span>
              <button
                className="links-chip-remove"
                onClick={() => removeLink(id)}
                title="Remove"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <div className="links-search">
        <Search size={12} />
        <input
          ref={inputRef}
          type="text"
          className="links-search-input"
          placeholder={value.length ? "Add another…" : "Search tables or columns…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
        />
      </div>

      {/* Dropdown */}
      {open && filtered.length > 0 && (
        <div className="links-dropdown">
          {filtered.slice(0, 30).map((opt) => (
            <button
              key={opt.id}
              className="links-dropdown-item"
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus on input
                addLink(opt.id);
              }}
            >
              <span className={`links-kind-badge ${opt.kind}`}>{opt.kind === "table" ? "T" : "C"}</span>
              <span className="links-dropdown-label">{opt.label}</span>
            </button>
          ))}
          {filtered.length > 30 && (
            <div className="links-dropdown-more">
              {filtered.length - 30} more — type to narrow
            </div>
          )}
        </div>
      )}
    </div>
  );
}
