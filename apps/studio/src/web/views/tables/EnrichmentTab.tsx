import { Loader2, Sparkles, ChevronRight } from "lucide-react";
import { useWorkspace } from "../../contexts/workspace-context";
import { Badge } from "../../components/ui/badge";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { ListInput } from "../../components/ui/list-input";
import { Textarea } from "../../components/ui/textarea";
import type { ReactNode } from "react";

export function EnrichmentTab() {
  const {
    workspace,
    selectedTable,
    selectedDraft,
    updateTableDraft,
    updateColumnDraft,
    requestSuggestion,
    suggestingKey,
  } = useWorkspace();

  if (!selectedTable || !selectedDraft || !workspace) return null;

  const aiConfigured = workspace.aiConfigured;
  const table = selectedTable;
  const draft = selectedDraft;
  const tableId = table.physical.id;

  return (
    <div className="stack" style={{ padding: "var(--pad-y) var(--pad-x)" }}>
      <section className="card">
        <div className="card-hd"><h3>Table Enrichment</h3></div>
        <div className="card-bd">
          <div style={{ display: "grid", gap: 16 }}>
            <FieldWithSuggest
              aiConfigured={aiConfigured}
              label="Description"
              onSuggest={() => requestSuggestion({ scope: "table", tableId, field: "description" }, "table description")}
              suggesting={suggestingKey === `table:${tableId}:description`}
            >
              <Textarea
                value={draft.description}
                onChange={(e) => updateTableDraft(tableId, (d) => ({ ...d, description: e.target.value }))}
              />
            </FieldWithSuggest>

            <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>
              <FieldWithSuggest
                aiConfigured={aiConfigured}
                label="Aliases"
                onSuggest={() => requestSuggestion({ scope: "table", tableId, field: "aliases" }, "table aliases")}
                suggesting={suggestingKey === `table:${tableId}:aliases`}
              >
                <ListInput
                  value={draft.aliases}
                  onChange={(v) => updateTableDraft(tableId, (d) => ({ ...d, aliases: v }))}
                />
              </FieldWithSuggest>
              <FieldWithSuggest
                aiConfigured={aiConfigured}
                label="Primary entity"
                onSuggest={() => requestSuggestion({ scope: "table", tableId, field: "primaryEntity" }, "primary entity")}
                suggesting={suggestingKey === `table:${tableId}:primaryEntity`}
              >
                <Input
                  value={draft.primaryEntity ?? ""}
                  onChange={(e) =>
                    updateTableDraft(tableId, (d) => ({
                      ...d,
                      primaryEntity: e.target.value.trim() || undefined,
                    }))
                  }
                />
              </FieldWithSuggest>
            </div>

            <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 220px" }}>
              <Field label="Tags" description="Comma-separated labels used for browsing and filtering.">
                <ListInput
                  value={draft.tags}
                  onChange={(v) => updateTableDraft(tableId, (d) => ({ ...d, tags: v }))}
                />
              </Field>
              <SensitiveSelect
                label="Table sensitivity override"
                value={draft.sensitive}
                onChange={(v) => updateTableDraft(tableId, (d) => ({ ...d, sensitive: v }))}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-hd"><h3>Common Query Language</h3></div>
        <div className="card-bd">
          <FieldWithSuggest
            aiConfigured={aiConfigured}
            label="Business vocabulary"
            onSuggest={() => requestSuggestion({ scope: "table", tableId, field: "commonQueryLanguage" }, "common query language")}
            suggesting={suggestingKey === `table:${tableId}:commonQueryLanguage`}
          >
            <Textarea
              className="min-h-36"
              value={draft.commonQueryLanguage ?? ""}
              onChange={(e) => updateTableDraft(tableId, (d) => ({ ...d, commonQueryLanguage: e.target.value }))}
            />
          </FieldWithSuggest>
        </div>
      </section>

      <section className="card">
        <div className="card-hd"><h3>Example Questions</h3></div>
        <div className="card-bd">
          <Field label="Questions">
            <Textarea
              className="min-h-32"
              value={draft.exampleQuestions ?? ""}
              onChange={(e) => updateTableDraft(tableId, (d) => ({ ...d, exampleQuestions: e.target.value }))}
            />
          </Field>
        </div>
      </section>

      <section className="card">
        <div className="card-hd">
          <h3>Columns</h3>
          {table.missingColumnIds.length > 0 && (
            <Badge variant={table.missingColumnIds.length > 0 ? "warning" : "secondary"}>
              {table.missingColumnIds.length} missing
            </Badge>
          )}
        </div>
        <div className="card-bd">
          <div style={{ display: "grid", gap: 12 }}>
            {table.physical.columns.map((column) => {
              const columnDraft = draft.columns[column.id] ?? {};
              return (
                <section className="column-row" key={column.id}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div>
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                        <h4 style={{ fontSize: 13, fontWeight: 600 }}>{column.name}</h4>
                        <Badge variant="outline">{column.type}</Badge>
                        {column.primaryKey && <Badge variant="secondary">PK</Badge>}
                        {column.nullable && <Badge variant="outline">nullable</Badge>}
                        {(column.sensitive || columnDraft.sensitive) && <Badge variant="danger">sensitive</Badge>}
                      </div>
                      <p className="muted tiny" style={{ marginTop: 4, wordBreak: "break-all" }}>{column.id}</p>
                    </div>
                  </div>
                  <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                    <FieldWithSuggest
                      aiConfigured={aiConfigured}
                      label="Description"
                      onSuggest={() =>
                        requestSuggestion(
                          { scope: "column", tableId, columnId: column.id, field: "description" },
                          `${column.name} description`,
                        )
                      }
                      suggesting={suggestingKey === `column:${tableId}:${column.id}:description`}
                    >
                      <Textarea
                        value={columnDraft.description ?? ""}
                        onChange={(e) =>
                          updateColumnDraft(tableId, column.id, (d) => ({ ...d, description: e.target.value }))
                        }
                      />
                    </FieldWithSuggest>
                    <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr" }}>
                      <FieldWithSuggest
                        aiConfigured={aiConfigured}
                        label="Aliases"
                        onSuggest={() =>
                          requestSuggestion(
                            { scope: "column", tableId, columnId: column.id, field: "aliases" },
                            `${column.name} aliases`,
                          )
                        }
                        suggesting={suggestingKey === `column:${tableId}:${column.id}:aliases`}
                      >
                        <ListInput
                          value={columnDraft.aliases}
                          onChange={(v) => updateColumnDraft(tableId, column.id, (d) => ({ ...d, aliases: v }))}
                        />
                      </FieldWithSuggest>
                      <Field label="Enum notes">
                        <ListInput
                          value={columnDraft.enum}
                          onChange={(v) => updateColumnDraft(tableId, column.id, (d) => ({ ...d, enum: v }))}
                        />
                      </Field>
                      <SensitiveSelect
                        label="Sensitivity override"
                        value={columnDraft.sensitive}
                        onChange={(v) => updateColumnDraft(tableId, column.id, (d) => ({ ...d, sensitive: v }))}
                      />
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-hd"><h3>Relationships</h3></div>
        <div className="card-bd">
          {table.physical.relationships && table.physical.relationships.length > 0 ? (
            <div style={{ display: "grid", gap: 8 }}>
              {table.physical.relationships.map((rel, i) => (
                <div className="relationship-row" key={`${rel.from}-${rel.to}-${i}`}>
                  <span style={{ wordBreak: "break-all" }}>{rel.from}</span>
                  <ChevronRight size={14} style={{ color: "var(--ink-400)", flexShrink: 0 }} />
                  <span style={{ wordBreak: "break-all" }}>{rel.to}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>No relationships recorded for this table.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function FieldWithSuggest({
  aiConfigured,
  children,
  label,
  onSuggest,
  suggesting,
}: {
  aiConfigured: boolean;
  children: ReactNode;
  label: string;
  onSuggest: () => Promise<void>;
  suggesting: boolean;
}) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span className="muted" style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
        <button
          type="button"
          className="suggest-link"
          disabled={!aiConfigured || suggesting}
          onClick={() => void onSuggest()}
          title={aiConfigured ? "Suggest with configured AI model" : "Configure an AI key to enable suggestions"}
        >
          {suggesting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          Suggest
        </button>
      </div>
      {children}
    </div>
  );
}

function SensitiveSelect({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: boolean | undefined) => void;
  value: boolean | undefined;
}) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span className="muted" style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
      <select
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={value === undefined ? "inherit" : value ? "true" : "false"}
        onChange={(e) => {
          if (e.target.value === "inherit") onChange(undefined);
          else onChange(e.target.value === "true");
        }}
      >
        <option value="inherit">Inherit physical metadata</option>
        <option value="true">Sensitive</option>
        <option value="false">Not sensitive</option>
      </select>
    </label>
  );
}
