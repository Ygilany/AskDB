import { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useNavigate, useParams } from "react-router";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, EyeOff, FolderOpen, Search, Sparkles } from "lucide-react";
import { useWorkspace } from "../../contexts/workspace-context";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible";

type EnrichLevel = "enriched" | "partial" | "none";
type TrackFilter = "tracked" | "untracked";

const LEVEL_LABELS: Record<EnrichLevel, string> = {
  enriched: "Complete",
  partial: "Partial",
  none: "Not started",
};

export function TablesLayout() {
  const navigate = useNavigate();
  const params = useParams<{ schema: string; name: string }>();
  const {
    filteredTables,
    tables,
    selectedTable,
    setSelectedTableId,
    tableSearch,
    setTableSearch,
    drafts,
  } = useWorkspace();

  // Enrichment filter state — null means "show all"
  const [enrichFilter, setEnrichFilter] = useState<Set<EnrichLevel> | null>(null);
  // Track filter — null means "show all"
  const [trackFilter, setTrackFilter] = useState<TrackFilter | null>(null);

  const getLevel = useCallback((t: typeof tables[0]): EnrichLevel => {
    const draft = drafts[t.physical.id] ?? t.draft;
    const hasSome = draft.description || (draft.aliases && draft.aliases.length > 0);
    const allCols = Object.values(draft.columns ?? {}).every((c) => c.description);
    return hasSome && allCols ? "enriched" : hasSome ? "partial" : "none";
  }, [drafts]);

  const isTracked = useCallback((t: typeof tables[0]): boolean => {
    const draft = drafts[t.physical.id] ?? t.draft;
    return draft.tracked !== false;
  }, [drafts]);

  // Count by enrichment level (across all tables, not just filtered)
  const levelCounts = useMemo(() => {
    const counts: Record<EnrichLevel, number> = { enriched: 0, partial: 0, none: 0 };
    for (const t of tables) counts[getLevel(t)]++;
    return counts;
  }, [tables, getLevel]);

  const untrackedCount = useMemo(() => tables.filter((t) => !isTracked(t)).length, [tables, isTracked]);

  // Apply enrichment + track filters on top of search-filtered tables
  const displayTables = useMemo(() => {
    let result = filteredTables;
    if (enrichFilter) result = result.filter((t) => enrichFilter.has(getLevel(t)));
    if (trackFilter === "tracked") result = result.filter((t) => isTracked(t));
    else if (trackFilter === "untracked") result = result.filter((t) => !isTracked(t));
    return result;
  }, [filteredTables, enrichFilter, trackFilter, getLevel, isTracked]);

  // Group tables by schema
  const schemaGroups = useMemo(() => {
    const groups = new Map<string, typeof displayTables>();
    for (const t of displayTables) {
      const schema = t.physical.schema;
      if (!groups.has(schema)) groups.set(schema, []);
      groups.get(schema)!.push(t);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [displayTables]);

  const allSchemas = useMemo(() => schemaGroups.map(([s]) => s), [schemaGroups]);

  // Track which schemas the user has explicitly collapsed; all others are open
  const [closedSchemas, setClosedSchemas] = useState<Set<string>>(new Set());
  const openSchemas = useMemo(
    () => new Set(allSchemas.filter((s) => !closedSchemas.has(s))),
    [allSchemas, closedSchemas],
  );

  const allExpanded = closedSchemas.size === 0;

  const collapseAll = () => setClosedSchemas(new Set(allSchemas));
  const expandAll = () => setClosedSchemas(new Set());

  // When searching, auto-expand all groups so results are visible
  useEffect(() => {
    if (tableSearch) setClosedSchemas(new Set());
  }, [tableSearch]);

  useEffect(() => {
    if (params.schema && params.name) {
      const id = `table:${params.schema}.${params.name}`;
      setSelectedTableId(id);
    } else if (tables.length > 0 && !params.schema) {
      const first = tables[0];
      navigate(`/tables/${first.physical.schema}/${first.physical.name}/enrichment`, { replace: true });
    }
  }, [params.schema, params.name, tables, navigate, setSelectedTableId]);

  function toggleFilter(level: EnrichLevel) {
    setEnrichFilter((prev) => {
      if (!prev) {
        // Nothing active → activate only this level
        return new Set([level]);
      }
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
        // If empty, clear filter entirely (show all)
        return next.size === 0 ? null : next;
      }
      next.add(level);
      // If all three selected, same as "show all"
      return next.size === 3 ? null : next;
    });
  }

  const hasOutlet = Boolean(params.schema && params.name);

  return (
    <>
      <div className="sub-rail">
        <div className="sub-rail-hd">
          <h2>Tables</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="muted tiny">{tables.length} tables</span>
            {schemaGroups.length > 1 && (
              <button
                type="button"
                className="btn ghost sm"
                onClick={allExpanded ? expandAll : collapseAll}
                title={allExpanded ? "Collapse all" : "Expand all"}
                style={{ padding: 2, height: 20, width: 20 }}
              >
                {allExpanded ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}
              </button>
            )}
          </div>
        </div>
        <div className="sub-rail-search">
          <Search size={13} />
          <input
            type="text"
            aria-label="Search tables"
            placeholder="Search tables…"
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
          />
        </div>
        <div className="enrich-filter-bar">
          {(["enriched", "partial", "none"] as EnrichLevel[]).map((level) => {
            const active = !enrichFilter || enrichFilter.has(level);
            return (
              <button
                type="button"
                key={level}
                className={`enrich-filter-chip ${level} ${active ? "active" : ""}`}
                onClick={() => toggleFilter(level)}
                title={`${active ? "Hide" : "Show"} ${LEVEL_LABELS[level].toLowerCase()} tables`}
              >
                <span className={`enrich-dot ${level}`} />
                <span className="enrich-filter-label">{LEVEL_LABELS[level]}</span>
                <span className="enrich-filter-count">{levelCounts[level]}</span>
              </button>
            );
          })}
          {untrackedCount > 0 && (
            <button
              type="button"
              className={`enrich-filter-chip untracked ${trackFilter === "untracked" ? "active" : ""}`}
              onClick={() => setTrackFilter((f) => f === "untracked" ? null : "untracked")}
              title={trackFilter === "untracked" ? "Show all tables" : `Show ${untrackedCount} untracked table${untrackedCount !== 1 ? "s" : ""}`}
            >
              <EyeOff size={11} />
              <span className="enrich-filter-label">Untracked</span>
              <span className="enrich-filter-count">{untrackedCount}</span>
            </button>
          )}
        </div>
        <div className="sub-rail-list">
          {schemaGroups.map(([schema, schemaTables]) => (
            <Collapsible
              key={schema}
              open={openSchemas.has(schema)}
              onOpenChange={(open) => {
                setClosedSchemas((prev) => {
                  const next = new Set(prev);
                  if (open) next.delete(schema);
                  else next.add(schema);
                  return next;
                });
              }}
            >
              <div className="schema-group">
                <CollapsibleTrigger asChild>
                  <button type="button" className="schema-group-hd">
                    <ChevronRight size={12} className="schema-chevron" style={{
                      transform: openSchemas.has(schema) ? "rotate(90deg)" : undefined,
                    }} />
                    <FolderOpen size={13} className="schema-icon" />
                    <span className="schema-name">{schema}</span>
                    <span className="schema-count">{schemaTables.length}</span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="schema-group-bd">
                    {schemaTables.map((t) => {
                      const level = getLevel(t);
                      const tracked = isTracked(t);
                      const isActive = selectedTable?.physical.id === t.physical.id;
                      return (
                        <button
                          type="button"
                          key={t.physical.id}
                          className={`sub-rail-row table-leaf ${isActive ? "active" : ""}${!tracked ? " untracked" : ""}`}
                          onClick={() => navigate(`/tables/${t.physical.schema}/${t.physical.name}/enrichment`)}
                          title={!tracked ? "Untracked — excluded from LLM context" : undefined}
                        >
                          {!tracked ? <EyeOff size={10} style={{ color: "var(--amber-500)", flex: "none" }} /> : <span className={`enrich-dot ${level}`} />}
                          <span className="row-name mono">{t.physical.name}</span>
                          <span className="row-meta">{t.physical.columns.length} cols</span>
                        </button>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          ))}
          {displayTables.length === 0 && (
            <div className="muted tiny" style={{ padding: "16px", textAlign: "center" }}>
              {trackFilter === "untracked" ? "No untracked tables" : enrichFilter ? "No tables match this filter" : "No tables match your search"}
            </div>
          )}
        </div>
      </div>
      {hasOutlet ? (
        <Outlet />
      ) : (
        <main className="main-pane">
          <div className="main-body" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ textAlign: "center", color: "var(--ink-400)" }}>
              <Sparkles size={24} style={{ margin: "0 auto 8px" }} />
              <p style={{ fontSize: 13 }}>Select a table to start enriching</p>
            </div>
          </div>
        </main>
      )}
    </>
  );
}
