import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Hexagon, Loader2, Plus, RotateCcw, Save, Search, Table2, X } from "lucide-react";
import type { V2Concept } from "@askdb/core";
import { useWorkspace } from "../../contexts/workspace-context";
import { useRag } from "../../contexts/rag-context";
import { Badge } from "../../components/ui/badge";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { ListInput } from "../../components/ui/list-input";
import { Textarea } from "../../components/ui/textarea";
import { StatusBanner } from "../../components/common/StatusBanner";

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
  const { refreshRagStatus } = useRag();

  const onSave = useCallback(async (concepts: V2Concept[]) => {
    await handleSaveConcepts(concepts);
    void refreshRagStatus();
  }, [handleSaveConcepts, refreshRagStatus]);

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

  const conceptsKey = workspace.concepts.map((c) => c.id).join(",");

  return (
    <main className="main-pane">
      <ConceptsEditor
        key={conceptsKey}
        concepts={workspace.concepts}
        linkOptions={linkOptions}
        onSave={onSave}
        saveStatus={saveStatus}
        busy={busy}
      />
    </main>
  );
}

/* ═══════════════ Editor state ═══════════════ */

type ConceptsState = {
  draft: V2Concept[];
  selectedIndex: number | null;
  addOpen: boolean;
  addDraft: Partial<V2Concept>;
  conceptSearch: string;
};

type ConceptsAction =
  | { type: "set_selectedIndex"; payload: number | null }
  | { type: "set_conceptSearch"; payload: string }
  | { type: "merge_addDraft"; payload: Partial<V2Concept> }
  | { type: "update_concept"; index: number; updater: (c: V2Concept) => V2Concept }
  | { type: "remove_concept"; index: number }
  | { type: "commit_add"; concept: V2Concept; newIndex: number }
  | { type: "open_add_form" }
  | { type: "select_concept"; index: number }
  | { type: "cancel_add" };

function conceptsReducer(state: ConceptsState, action: ConceptsAction): ConceptsState {
  switch (action.type) {
    case "set_selectedIndex": return { ...state, selectedIndex: action.payload };
    case "set_conceptSearch": return { ...state, conceptSearch: action.payload };
    case "merge_addDraft": return { ...state, addDraft: { ...state.addDraft, ...action.payload } };
    case "update_concept": return {
      ...state,
      draft: state.draft.map((c, i) => i === action.index ? action.updater(clone(c)) : c),
    };
    case "remove_concept": {
      const next = state.draft.filter((_, i) => i !== action.index);
      let nextSelected = state.selectedIndex;
      if (state.selectedIndex === action.index) nextSelected = null;
      else if (state.selectedIndex !== null && state.selectedIndex > action.index) nextSelected = state.selectedIndex - 1;
      return { ...state, draft: next, selectedIndex: nextSelected };
    }
    case "commit_add": return {
      ...state,
      draft: [...state.draft, action.concept],
      selectedIndex: action.newIndex,
      addDraft: {},
      addOpen: false,
    };
    case "open_add_form": return { ...state, addOpen: true, selectedIndex: null };
    case "select_concept": return { ...state, selectedIndex: action.index, addOpen: false };
    case "cancel_add": return { ...state, addOpen: false, addDraft: {} };
  }
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
  const [state, dispatch] = useReducer(conceptsReducer, null, (): ConceptsState => ({
    draft: clone(concepts),
    selectedIndex: null,
    addOpen: false,
    addDraft: {},
    conceptSearch: "",
  }));
  const { draft, selectedIndex, addOpen, addDraft, conceptSearch } = state;

  const dirty = JSON.stringify(draft) !== JSON.stringify(concepts);

  // Filtered concepts for the sub-rail list
  const filteredDraft = useMemo(() => {
    if (!conceptSearch) return draft.map((c, i) => ({ concept: c, index: i }));
    const q = conceptSearch.toLowerCase();
    return draft.flatMap((c, i) => {
      const matches =
        c.label.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.synonyms?.some((s) => s.toLowerCase().includes(q));
      return matches ? [{ concept: c, index: i }] : [];
    });
  }, [draft, conceptSearch]);

  const selectedConcept = selectedIndex !== null ? draft[selectedIndex] : null;

  function updateConcept(index: number, updater: (c: V2Concept) => V2Concept) {
    dispatch({ type: "update_concept", index, updater });
  }

  function removeConcept(index: number) {
    dispatch({ type: "remove_concept", index });
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
    dispatch({ type: "commit_add", concept, newIndex: draft.length });
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
            type="button"
            className="btn"
            onClick={() => { setDraft(clone(concepts)); setSelectedIndex(null); }}
            disabled={!dirty || busy.has("save-concepts")}
          >
            <RotateCcw size={14} /> Revert
          </button>
          <button
            type="button"
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

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", flex: 1, minHeight: 0, overflow: "hidden" }}>
        {/* ── Left: concept list ── */}
        <div className="sub-rail" style={{ borderRight: "1px solid var(--border)" }}>
          <div className="sub-rail-hd">
            <h2>Concepts</h2>
            <span className="muted tiny">{draft.length}</span>
          </div>
          <div className="sub-rail-search">
            <Search size={13} />
            <input
              type="text"
              aria-label="Search concepts"
              placeholder="Search concepts…"
              value={conceptSearch}
              onChange={(e) => dispatch({ type: "set_conceptSearch", payload: e.target.value })}
            />
          </div>
          <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
            <button
              type="button"
              className="btn sm"
              style={{ width: "100%", justifyContent: "center" }}
              onClick={() => dispatch({ type: "open_add_form" })}
            >
              <Plus size={12} /> Add concept
            </button>
          </div>
          <div className="sub-rail-list">
            {filteredDraft.map(({ concept, index }) => (
              <button
                type="button"
                key={concept.id}
                className={`sub-rail-row ${selectedIndex === index ? "active" : ""}`}
                onClick={() => dispatch({ type: "select_concept", index })}
              >
                <Hexagon size={12} style={{ flexShrink: 0, color: "var(--ink-400)" }} />
                <span className="row-name">{concept.label}</span>
                <span className="row-meta">{concept.links?.length ?? 0} links</span>
              </button>
            ))}
            {filteredDraft.length === 0 && (
              <div className="muted tiny" style={{ padding: "16px", textAlign: "center" }}>
                {conceptSearch ? "No concepts match your search" : "No concepts yet"}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: detail ── */}
        <div style={{ overflow: "auto", padding: "var(--pad-y) var(--pad-x)" }}>
          {addOpen ? (
            <div className="stack">
              <section className="card">
                <div className="card-hd"><h3>New Concept</h3></div>
                <div className="card-bd">
                  <div style={{ display: "grid", gap: 12 }}>
                    <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
                      <Field label="ID" description="Unique slug (concept: prefix added automatically)">
                        <ConceptIdInput
                          value={addDraft.id ?? ""}
                          onChange={(v) => dispatch({ type: "merge_addDraft", payload: { id: v } })}
                          placeholder="revenue"
                        />
                      </Field>
                      <Field label="Label" description='Human-readable name, e.g. "Revenue"'>
                        <Input
                          value={addDraft.label ?? ""}
                          placeholder="Revenue"
                          onChange={(e) => dispatch({ type: "merge_addDraft", payload: { label: e.target.value } })}
                        />
                      </Field>
                    </div>
                    <Field label="Synonyms" description="Comma-separated terms users might say">
                      <ListInput
                        value={addDraft.synonyms}
                        onChange={(v) => dispatch({ type: "merge_addDraft", payload: { synonyms: v } })}
                      />
                    </Field>
                    <Field label="Links" description="Tables or columns this concept maps to">
                      <LinksInput
                        value={addDraft.links ?? []}
                        onChange={(v) => dispatch({ type: "merge_addDraft", payload: { links: v } })}
                        options={linkOptions}
                      />
                    </Field>
                    <Field label="Description" description="How this concept is computed or what it means">
                      <Textarea
                        value={addDraft.description ?? ""}
                        placeholder="Sum of orders.total_amount where status = 'paid', expressed in cents."
                        onChange={(e) => dispatch({ type: "merge_addDraft", payload: { description: e.target.value } })}
                      />
                    </Field>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button type="button" className="btn" onClick={() => dispatch({ type: "cancel_add" })}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn primary"
                        onClick={commitAdd}
                        disabled={!addDraft.id?.trim() || !addDraft.label?.trim()}
                      >
                        Add concept
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          ) : selectedConcept && selectedIndex !== null ? (
            <ConceptDetail
              concept={selectedConcept}
              linkOptions={linkOptions}
              onChange={(updater) => updateConcept(selectedIndex, updater)}
              onRemove={() => removeConcept(selectedIndex)}
            />
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
              <div style={{ textAlign: "center", color: "var(--ink-400)" }}>
                <Hexagon size={24} style={{ margin: "0 auto 8px" }} />
                <p style={{ fontSize: 13 }}>
                  {draft.length === 0
                    ? 'Click "Add concept" to create your first one'
                    : "Select a concept to edit"}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ═══════════════ Concept detail ═══════════════ */

function ConceptDetail({
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
    <div className="stack">
      <section className="card">
        <div className="card-hd">
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <h3>{concept.label}</h3>
            <Badge variant="outline">{concept.id}</Badge>
          </div>
          <button type="button" className="btn ghost sm" onClick={onRemove} title="Remove concept" style={{ color: "var(--red-600)" }}>
            Remove
          </button>
        </div>
        <div className="card-bd">
          <div style={{ display: "grid", gap: 12 }}>
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
        </div>
      </section>
    </div>
  );
}

/* ═══════════════ ConceptIdInput ═══════════════ */

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
        aria-label="Concept ID"
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
  const [highlightIndex, setHighlightIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  // Cap visible items for dropdown
  const visible = filtered.slice(0, 30);


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

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !dropdownRef.current) return;
    const items = dropdownRef.current.querySelectorAll("[data-link-item]");
    const item = items[highlightIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, open]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightIndex((prev) => Math.min(prev + 1, visible.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightIndex((prev) => Math.max(prev - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (visible[highlightIndex]) {
          addLink(visible[highlightIndex].id);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
    }
  }

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
                type="button"
                className="links-chip-remove"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  removeLink(id);
                }}
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
          aria-label="Search tables or columns"
          className="links-search-input"
          placeholder={value.length ? "Add another…" : "Search tables or columns…"}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setHighlightIndex(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
      </div>

      {/* Dropdown */}
      {open && visible.length > 0 && (
        <div className="links-dropdown" ref={dropdownRef} role={"listbox" as React.AriaRole}>
          {visible.map((opt, i) => (
            <button
              type="button"
              key={opt.id}
              data-link-item
              role={"option" as React.AriaRole}
              aria-selected={i === highlightIndex}
              className={`links-dropdown-item ${i === highlightIndex ? "highlighted" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                addLink(opt.id);
              }}
              onMouseEnter={() => setHighlightIndex(i)}
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
