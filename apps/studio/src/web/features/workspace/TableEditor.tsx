import { ChevronRight } from "lucide-react";
import type { ColumnDraft, SuggestSource, TableDraft } from "@askdb/enrich";
import type { StudioTableDto } from "@/shared/api";
import { Badge, Field, Input, Panel, Textarea } from "../../components/ui";
import { FieldWithSuggest } from "../../components/common/FieldWithSuggest";
import { SensitiveSelect } from "../../components/common/SensitiveSelect";
import { emptyToUndefined, formatList, parseList } from "../../lib/format";

export function TableEditor({
  aiConfigured,
  draft,
  onRequestSuggestion,
  onUpdateColumn,
  onUpdateTable,
  suggestingKey,
  table,
}: {
  aiConfigured: boolean;
  draft: TableDraft;
  onRequestSuggestion: (source: SuggestSource, label: string) => Promise<void>;
  onUpdateColumn: (
    tableId: string,
    columnId: string,
    updater: (draft: ColumnDraft) => ColumnDraft,
  ) => void;
  onUpdateTable: (tableId: string, updater: (draft: TableDraft) => TableDraft) => void;
  suggestingKey: string | null;
  table: StudioTableDto;
}) {
  const tableId = table.physical.id;
  return (
    <>
      <Panel title="Table Enrichment">
        <div className="grid gap-4">
          <FieldWithSuggest
            aiConfigured={aiConfigured}
            label="Description"
            onSuggest={() =>
              onRequestSuggestion(
                { scope: "table", tableId, field: "description" },
                "table description",
              )
            }
            suggesting={suggestingKey === `table:${tableId}:description`}
          >
            <Textarea
              value={draft.description}
              onChange={(event) =>
                onUpdateTable(tableId, (current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </FieldWithSuggest>

          <div className="grid gap-4 lg:grid-cols-2">
            <FieldWithSuggest
              aiConfigured={aiConfigured}
              label="Aliases"
              onSuggest={() =>
                onRequestSuggestion(
                  { scope: "table", tableId, field: "aliases" },
                  "table aliases",
                )
              }
              suggesting={suggestingKey === `table:${tableId}:aliases`}
            >
              <Input
                value={formatList(draft.aliases)}
                onChange={(event) =>
                  onUpdateTable(tableId, (current) => ({
                    ...current,
                    aliases: parseList(event.target.value),
                  }))
                }
              />
            </FieldWithSuggest>
            <FieldWithSuggest
              aiConfigured={aiConfigured}
              label="Primary entity"
              onSuggest={() =>
                onRequestSuggestion(
                  { scope: "table", tableId, field: "primaryEntity" },
                  "primary entity",
                )
              }
              suggesting={suggestingKey === `table:${tableId}:primaryEntity`}
            >
              <Input
                value={draft.primaryEntity ?? ""}
                onChange={(event) =>
                  onUpdateTable(tableId, (current) => ({
                    ...current,
                    primaryEntity: emptyToUndefined(event.target.value),
                  }))
                }
              />
            </FieldWithSuggest>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
            <Field label="Tags" description="Comma-separated labels used for browsing and filtering.">
              <Input
                value={formatList(draft.tags)}
                onChange={(event) =>
                  onUpdateTable(tableId, (current) => ({
                    ...current,
                    tags: parseList(event.target.value),
                  }))
                }
              />
            </Field>
            <SensitiveSelect
              label="Table sensitivity override"
              value={draft.sensitive}
              onChange={(value) =>
                onUpdateTable(tableId, (current) => ({
                  ...current,
                  sensitive: value,
                }))
              }
            />
          </div>
        </div>
      </Panel>

      <Panel title="Common Query Language">
        <FieldWithSuggest
          aiConfigured={aiConfigured}
          label="Business vocabulary"
          onSuggest={() =>
            onRequestSuggestion(
              { scope: "table", tableId, field: "commonQueryLanguage" },
              "common query language",
            )
          }
          suggesting={suggestingKey === `table:${tableId}:commonQueryLanguage`}
        >
          <Textarea
            className="min-h-36"
            value={draft.commonQueryLanguage ?? ""}
            onChange={(event) =>
              onUpdateTable(tableId, (current) => ({
                ...current,
                commonQueryLanguage: event.target.value,
              }))
            }
          />
        </FieldWithSuggest>
      </Panel>

      <Panel title="Example Questions">
        <Field label="Questions">
          <Textarea
            className="min-h-32"
            value={draft.exampleQuestions ?? ""}
            onChange={(event) =>
              onUpdateTable(tableId, (current) => ({
                ...current,
                exampleQuestions: event.target.value,
              }))
            }
          />
        </Field>
      </Panel>

      <Panel
        title="Columns"
        action={
          <Badge variant={table.missingColumnIds.length > 0 ? "warning" : "secondary"}>
            {table.missingColumnIds.length} missing
          </Badge>
        }
      >
        <div className="grid gap-3">
          {table.physical.columns.map((column) => {
            const columnDraft = draft.columns[column.id] ?? {};
            return (
              <section className="column-row" key={column.id}>
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="truncate text-sm font-semibold">{column.name}</h4>
                      <Badge variant="outline">{column.type}</Badge>
                      {column.primaryKey ? <Badge variant="secondary">PK</Badge> : null}
                      {column.nullable ? <Badge variant="outline">nullable</Badge> : null}
                      {column.sensitive || columnDraft.sensitive ? (
                        <Badge variant="danger">sensitive</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 break-all text-xs text-muted-foreground">{column.id}</p>
                  </div>
                </div>
                <div className="mt-3 grid gap-3">
                  <FieldWithSuggest
                    aiConfigured={aiConfigured}
                    label="Description"
                    onSuggest={() =>
                      onRequestSuggestion(
                        { scope: "column", tableId, columnId: column.id, field: "description" },
                        `${column.name} description`,
                      )
                    }
                    suggesting={suggestingKey === `column:${tableId}:${column.id}:description`}
                  >
                    <Textarea
                      value={columnDraft.description ?? ""}
                      onChange={(event) =>
                        onUpdateColumn(tableId, column.id, (current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                    />
                  </FieldWithSuggest>
                  <div className="grid gap-3 lg:grid-cols-3">
                    <FieldWithSuggest
                      aiConfigured={aiConfigured}
                      label="Aliases"
                      onSuggest={() =>
                        onRequestSuggestion(
                          { scope: "column", tableId, columnId: column.id, field: "aliases" },
                          `${column.name} aliases`,
                        )
                      }
                      suggesting={suggestingKey === `column:${tableId}:${column.id}:aliases`}
                    >
                      <Input
                        value={formatList(columnDraft.aliases)}
                        onChange={(event) =>
                          onUpdateColumn(tableId, column.id, (current) => ({
                            ...current,
                            aliases: parseList(event.target.value),
                          }))
                        }
                      />
                    </FieldWithSuggest>
                    <Field label="Enum notes">
                      <Input
                        value={formatList(columnDraft.enum)}
                        onChange={(event) =>
                          onUpdateColumn(tableId, column.id, (current) => ({
                            ...current,
                            enum: parseList(event.target.value),
                          }))
                        }
                      />
                    </Field>
                    <SensitiveSelect
                      label="Sensitivity override"
                      value={columnDraft.sensitive}
                      onChange={(value) =>
                        onUpdateColumn(tableId, column.id, (current) => ({
                          ...current,
                          sensitive: value,
                        }))
                      }
                    />
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </Panel>

      <Panel title="Relationships">
        {table.physical.relationships && table.physical.relationships.length > 0 ? (
          <div className="grid gap-2">
            {table.physical.relationships.map((relationship, index) => (
              <div className="relationship-row" key={`${relationship.from}-${relationship.to}-${index}`}>
                <span className="break-all">{relationship.from}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="break-all">{relationship.to}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No relationships recorded for this table.
          </p>
        )}
      </Panel>
    </>
  );
}
