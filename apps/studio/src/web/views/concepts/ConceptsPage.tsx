import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Hexagon, Loader2, Plus, RotateCcw, Save, Search, Table2, X } from "lucide-react";
import type { V2Concept } from "@askdb/core";
import { useWorkspace } from "../../contexts/workspace-context";
import { Badge, Field, Input, ListInput, Textarea } from "../../components/ui";
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
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addDraft, setAddDraft] = useState<Partial<V2Concept>>({});
  const [conceptSearch, setConceptSearch] = useState("");

  const dirty = JSON.stringify(draft) !== JSON.stringify(concepts);

  // Filtered concepts for the sub-rail list
  const filteredDraft = useMemo(() => {
    if (!conceptSearch) return draft.map((c, i) => ({ concept: c, index: i }));
    const q = conceptSearch.toLowerCase();
    return draft
      .map((c, i) => ({ concept: c, index: i }))
      .filter(({ concept }) =>
        concept.label.toLowerCase().includes(q) ||
        concept.id.toLowerCase().includes(q) ||
        concept.synonyms?.some((s) => s.toLowerCase().includes(q)),
      );
  }, [draft, conceptSearch]);

  const selectedConcept = selectedIndex !== null ? draft[selectedIndex] : null;

  function updateConcept(index: number, updater: (c: V2Concept) => V2Concept) {
    setDraft((current) => current.map((c, i) => (i === index ? updater(clone(c)) : c)));
  }

  function removeConcept(index: number) {
    setDraft((current) => current.filter((_, i) => i !== index));
    setSelectedIndex((prev) => {
      if (prev === index) return null;
      if (prev !== null && prev > index) return prev - 1;
      return prev;
    });
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
    setSelectedIndex(draft.length); // select the newly added one
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
              placeholder="Search concepts…"
              value={conceptSearch}
              onChange={(e) => setConceptSearch(e.target.value)}
            />
          </div>
          <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
            <button
              type="button"
              className="btn sm"
              style={{ width: "100%", justifyContent: "center" }}
              onClick={() => { setAddOpen(true); setSelectedIndex(null); }}
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
                onClick={() => { setSelectedIndex(index); setAddOpen(false); }}
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
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button type="button" className="btn" onClick={() => { setAddOpen(false); setAddDraft({}); }}>
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
        <div className="links-dropdown" ref={dropdownRef} role="listbox">
          {visible.map((opt, i) => (
            <button
              type="button"
              key={opt.id}
              data-link-item
              role="option"
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
