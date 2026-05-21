import { useEffect, useMemo, useState } from "react";
import { Outlet, useNavigate, useParams } from "react-router";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, FolderOpen, Search, Sparkles } from "lucide-react";
import { useWorkspace } from "../../contexts/workspace-context";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible";

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

  // Group tables by schema
  const schemaGroups = useMemo(() => {
    const groups = new Map<string, typeof filteredTables>();
    for (const t of filteredTables) {
      const schema = t.physical.schema;
      if (!groups.has(schema)) groups.set(schema, []);
      groups.get(schema)!.push(t);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredTables]);

  const allSchemas = useMemo(() => schemaGroups.map(([s]) => s), [schemaGroups]);

  // Track which schemas are open — all open by default
  const [openSchemas, setOpenSchemas] = useState<Set<string>>(new Set(allSchemas));

  // Keep openSchemas in sync when new schemas appear
  useEffect(() => {
    setOpenSchemas((prev) => {
      const next = new Set(prev);
      for (const s of allSchemas) {
        if (!next.has(s)) next.add(s);
      }
      return next;
    });
  }, [allSchemas]);

  const allExpanded = allSchemas.every((s) => openSchemas.has(s));

  const collapseAll = () => setOpenSchemas(new Set());
  const expandAll = () => setOpenSchemas(new Set(allSchemas));

  // When searching, auto-expand all groups so results are visible
  useEffect(() => {
    if (tableSearch) setOpenSchemas(new Set(allSchemas));
  }, [tableSearch]);

  useEffect(() => {
    if (params.schema && params.name) {
      const id = `table:${params.schema}.${params.name}`;
      setSelectedTableId(id);
    } else if (tables.length > 0 && !params.schema) {
      const first = tables[0];
      navigate(`/tables/${first.physical.schema}/${first.physical.name}/enrichment`, { replace: true });
    }
  }, [params.schema, params.name, tables]);

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
            placeholder="Search tables…"
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
          />
        </div>
        <div className="sub-rail-list">
          {schemaGroups.map(([schema, schemaTables]) => (
            <Collapsible
              key={schema}
              open={openSchemas.has(schema)}
              onOpenChange={(open) => {
                setOpenSchemas((prev) => {
                  const next = new Set(prev);
                  if (open) next.add(schema);
                  else next.delete(schema);
                  return next;
                });
              }}
            >
              <div className="schema-group">
                <CollapsibleTrigger asChild>
                  <button className="schema-group-hd">
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
                      const draft = drafts[t.physical.id] ?? t.draft;
                      const hasSome = draft.description || (draft.aliases && draft.aliases.length > 0);
                      const allCols = Object.values(draft.columns ?? {}).every((c) => c.description);
                      const level = hasSome && allCols ? "enriched" : hasSome ? "partial" : "none";
                      const isActive = selectedTable?.physical.id === t.physical.id;
                      return (
                        <button
                          key={t.physical.id}
                          className={`sub-rail-row table-leaf ${isActive ? "active" : ""}`}
                          onClick={() => navigate(`/tables/${t.physical.schema}/${t.physical.name}/enrichment`)}
                        >
                          <span className={`enrich-dot ${level}`} />
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
          {filteredTables.length === 0 && (
            <div className="muted tiny" style={{ padding: "16px", textAlign: "center" }}>
              No tables match your search
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
