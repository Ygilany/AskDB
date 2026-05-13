import { Loader2, RotateCcw, Save } from "lucide-react";
import type { StudioWorkspaceDto } from "@/shared/api";
import { Badge, Button } from "../../components/ui";
import type { UseWorkspaceReturn } from "./useWorkspace";

export function WorkspaceHeader({
  workspace,
  selectedTable,
  dirty,
  isSaving,
  onSave,
  onRevert,
}: {
  workspace: StudioWorkspaceDto;
  selectedTable: UseWorkspaceReturn["selectedTable"];
  dirty: boolean;
  isSaving: boolean;
  onSave: () => void;
  onRevert: () => void;
}) {
  return (
    <header className="flex min-h-16 items-center justify-between gap-4 border-b border-border bg-card px-5 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate text-lg font-semibold">
            {selectedTable?.physical.name ?? "No table selected"}
          </h2>
          {dirty ? (
            <Badge variant="warning">Unsaved</Badge>
          ) : (
            <Badge variant="secondary">Saved</Badge>
          )}
          {selectedTable?.physical.sensitive ? (
            <Badge variant="danger">Sensitive</Badge>
          ) : null}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {selectedTable
            ? `${selectedTable.physical.schema}.${selectedTable.physical.name} · ${selectedTable.physical.id}`
            : workspace.schemaId}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <Button variant="outline" onClick={onRevert} disabled={!dirty || isSaving}>
          <RotateCcw className="h-4 w-4" />
          Revert
        </Button>
        <Button onClick={onSave} disabled={!dirty || isSaving}>
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save
        </Button>
      </div>
    </header>
  );
}
