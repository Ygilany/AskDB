import { ChevronRight, Search } from "lucide-react";
import type { StudioWorkspaceDto } from "@/shared/api";
import { Badge, Input } from "../../components/ui";
import { Metric } from "../../components/common/Metric";
import { cn } from "../../lib/utils";
import type { UseWorkspaceReturn } from "./useWorkspace";

export function WorkspaceSidebar({
  workspace,
  filteredTables,
  selectedTable,
  setSelectedTableId,
  tableSearch,
  setTableSearch,
}: {
  workspace: StudioWorkspaceDto;
  filteredTables: UseWorkspaceReturn["filteredTables"];
  selectedTable: UseWorkspaceReturn["selectedTable"];
  setSelectedTableId: UseWorkspaceReturn["setSelectedTableId"];
  tableSearch: string;
  setTableSearch: (value: string) => void;
}) {
  return (
    <aside className="studio-sidebar">
      <div className="border-b border-border px-4 py-4">
        <div className="flex items-center gap-2">
          <img className="h-9 w-auto" src="/assets/brand/logo.png" alt="AskDB" />
          <h1 className="sr-only">AskDB Studio</h1>
          <span className="rounded border border-border px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
            Studio
          </span>
        </div>
        <p className="mt-1 break-all text-xs text-muted-foreground">{workspace.schemaDir}</p>
      </div>

      <div className="grid grid-cols-3 gap-2 border-b border-border p-3">
        <Metric value={workspace.tables.length} label="Tables" />
        <Metric value={workspace.warnings.length} label="Warnings" />
        <Metric value={workspace.concepts.length} label="Concepts" />
      </div>

      <div className="border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search tables"
            value={tableSearch}
            onChange={(event) => setTableSearch(event.target.value)}
          />
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-auto p-2" aria-label="Tables">
        {filteredTables.map((table) => {
          const isActive = table.physical.id === selectedTable?.physical.id;
          const warningCount =
            table.missingColumnIds.length +
            workspace.warnings.filter(
              (warning) => "tableId" in warning && warning.tableId === table.physical.id,
            ).length;
          return (
            <button
              className={cn("table-nav-item", isActive && "table-nav-item-active")}
              key={table.physical.id}
              type="button"
              onClick={() => setSelectedTableId(table.physical.id)}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{table.physical.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {table.physical.schema} · {table.physical.columns.length} columns
                </span>
              </span>
              <span className="flex items-center gap-1">
                {warningCount > 0 ? <Badge variant="warning">{warningCount}</Badge> : null}
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
