import { useEffect, useMemo, useState } from "react";
import { Outlet, useNavigate, useParams } from "react-router";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, FolderOpen, Search, Sparkles } from "lucide-react";
import { useWorkspace } from "../../contexts/workspace-context";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarGroupAction,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarProvider,
  SidebarInput,
} from "../../components/ui/sidebar";
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
    <SidebarProvider
      defaultOpen={true}
      className="min-h-0"
      style={{
        "--sidebar-width": "var(--sub-w)",
        "--sidebar-width-icon": "var(--sub-w)",
        gridColumn: "2 / -1",
      } as React.CSSProperties}
    >
      <Sidebar collapsible="none" className="border-r">
        <SidebarHeader className="gap-2 px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-sidebar-accent-foreground">Tables</span>
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-muted-foreground">{tables.length} tables</span>
              {schemaGroups.length > 1 && (
                <button
                  onClick={allExpanded ? collapseAll : expandAll}
                  title={allExpanded ? "Collapse all" : "Expand all"}
                  className="inline-flex items-center justify-center rounded-md p-0.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                >
                  {allExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
                </button>
              )}
            </div>
          </div>
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <SidebarInput
              placeholder="Search tables…"
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              className="pl-8"
            />
          </div>
        </SidebarHeader>

        <SidebarContent>
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
              className="group/collapsible"
            >
              <SidebarGroup className="py-0">
                <SidebarGroupLabel asChild className="h-8 text-xs">
                  <CollapsibleTrigger className="flex w-full items-center gap-1.5">
                    <ChevronRight size={14} className="shrink-0 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    <FolderOpen size={14} className="shrink-0 text-muted-foreground" />
                    <span className="truncate font-mono font-semibold">{schema}</span>
                    <span className="ml-auto tabular-nums text-muted-foreground">{schemaTables.length}</span>
                  </CollapsibleTrigger>
                </SidebarGroupLabel>

                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {schemaTables.map((t) => {
                        const draft = drafts[t.physical.id] ?? t.draft;
                        const hasSome = draft.description || (draft.aliases && draft.aliases.length > 0);
                        const allCols = Object.values(draft.columns ?? {}).every((c) => c.description);
                        const level = hasSome && allCols ? "enriched" : hasSome ? "partial" : "none";
                        const isActive = selectedTable?.physical.id === t.physical.id;
                        return (
                          <SidebarMenuItem key={t.physical.id}>
                            <SidebarMenuButton
                              isActive={isActive}
                              onClick={() => navigate(`/tables/${t.physical.schema}/${t.physical.name}/enrichment`)}
                              tooltip={`${t.physical.schema}.${t.physical.name}`}
                              className="pl-8 font-mono text-xs"
                            >
                              <span className={`enrich-dot ${level}`} />
                              <span className="truncate">{t.physical.name}</span>
                              <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">{t.physical.columns.length} cols</span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          ))}

          {filteredTables.length === 0 && (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              No tables match your search
            </div>
          )}
        </SidebarContent>
      </Sidebar>

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
    </SidebarProvider>
  );
}
