import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { V2Table } from "@askdb/core";
import {
  findSensitiveColumnReferences,
  formatList,
  parseListInput,
  type TableDraft,
} from "@askdb/enrich";
import type { TableSuggestField } from "@askdb/enrich";
import { TextInput } from "./TextInput.js";

type TableDetailProps = {
  physical: V2Table;
  draft: TableDraft;
  saved: boolean;
  onChange: (next: TableDraft) => void;
  onSave: () => void;
  onSuggestField?: (field: TableSuggestField) => void;
  onOpenColumn: (columnId: string) => void;
  onBack: () => void;
  suggesting?: boolean;
  suggestError?: string | null;
  missingColumnIds?: Set<string>;
};

type FieldId =
  | "description"
  | "aliases"
  | "primaryEntity"
  | "tags"
  | "sensitive"
  | "commonQueryLanguage"
  | "exampleQuestions";

const TABLE_FIELDS: FieldId[] = [
  "description",
  "aliases",
  "primaryEntity",
  "tags",
  "sensitive",
  "commonQueryLanguage",
  "exampleQuestions",
];

export function TableDetail({
  physical,
  draft,
  saved,
  onChange,
  onSave,
  onSuggestField,
  onOpenColumn,
  onBack,
  suggesting = false,
  suggestError = null,
  missingColumnIds = new Set(),
}: TableDetailProps): JSX.Element {
  const items = TABLE_FIELDS.length + physical.columns.length;
  const [activeIdx, setActiveIdx] = useState(0);
  const [editing, setEditing] = useState<FieldId | null>(null);

  useInput((input, key) => {
    if (editing) return;
    if (key.upArrow) setActiveIdx(Math.max(0, activeIdx - 1));
    else if (key.downArrow) setActiveIdx(Math.min(items - 1, activeIdx + 1));
    else if (key.return) {
      if (activeIdx < TABLE_FIELDS.length) {
        const f = TABLE_FIELDS[activeIdx]!;
        if (f === "sensitive") {
          const current = draft.sensitive ?? physical.sensitive ?? false;
          onChange({ ...draft, sensitive: !current });
        } else {
          setEditing(f);
        }
      } else {
        const col = physical.columns[activeIdx - TABLE_FIELDS.length]!;
        onOpenColumn(col.id);
      }
    } else if (input === "s") onSave();
    else if (input === "g" && activeIdx < TABLE_FIELDS.length) {
      const f = TABLE_FIELDS[activeIdx]!;
      if (isSuggestableTableField(f)) onSuggestField?.(f);
    } else if (input === "b" || key.escape) onBack();
  });

  const sensitiveRefs = findSensitiveColumnReferences(draft.description, physical);

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="single" paddingX={1}>
      <Text bold>{physical.name}</Text>
      <Text dimColor>
        {physical.schema}.{physical.name} · {physical.columns.length} columns
        {physical.sensitive ? " · sensitive" : ""}
      </Text>

      <Box marginTop={1} flexDirection="column">
        {TABLE_FIELDS.map((f, i) => (
          <FieldRow
            key={f}
            label={fieldLabel(f)}
            value={fieldDisplay(f, draft, physical)}
            active={i === activeIdx && editing === null}
            editing={editing === f}
            multiline={
              f === "commonQueryLanguage" ||
              f === "exampleQuestions"
            }
            onSubmit={(text) => {
              onChange(applyTableEdit(f, draft, text));
              setEditing(null);
              if (f === "description") {
                setActiveIdx(Math.min(items - 1, i + 1));
              }
            }}
            onCancel={() => setEditing(null)}
          />
        ))}
      </Box>

      {sensitiveRefs.length > 0 ? (
        <Box marginTop={1}>
          <Text color="yellow">
            ⚠ Description mentions sensitive column(s): {sensitiveRefs.join(", ")}.
            RAG will exclude this chunk by default.
          </Text>
        </Box>
      ) : null}

      <Box marginTop={1} flexDirection="column">
        <Text bold>Columns</Text>
        {physical.columns.map((c, i) => {
          const idx = TABLE_FIELDS.length + i;
          const active = idx === activeIdx && editing === null;
          const cd = draft.columns[c.id];
          const described = (cd?.description ?? "") !== "" || (cd?.aliases?.length ?? 0) > 0;
          return (
            <Text key={c.id}>
              <Text color={active ? "cyan" : undefined}>
                {active ? "▶ " : "  "}
                {c.name}
              </Text>
              <Text dimColor> {c.type}</Text>
              {c.primaryKey ? <Text color="cyan"> [pk]</Text> : null}
              {(cd?.sensitive ?? c.sensitive) ? <Text color="yellow"> [sensitive]</Text> : null}
              {missingColumnIds.has(c.id) ? <Text color="yellow"> [needs description]</Text> : null}
              {described ? <Text color="green"> ✓</Text> : null}
            </Text>
          );
        })}
      </Box>

      {saved ? (
        <Box marginTop={1}>
          <Text color="green">✓ Saved</Text>
        </Box>
      ) : null}
      {suggesting ? (
        <Box marginTop={1}>
          <Text color="cyan">Suggesting…</Text>
        </Box>
      ) : null}
      {suggestError ? (
        <Box marginTop={1}>
          <Text color="red">{suggestError}</Text>
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text dimColor>
          {editing
            ? "type to edit · ⏎ submit (Ctrl-D for multiline) · Esc cancel"
            : "↑↓ navigate · ⏎ edit/open · g suggest · s save · b back"}
        </Text>
      </Box>
    </Box>
  );
}

function isSuggestableTableField(f: FieldId): f is TableSuggestField {
  return (
    f === "description" ||
    f === "aliases" ||
    f === "primaryEntity" ||
    f === "commonQueryLanguage"
  );
}

function fieldLabel(f: FieldId): string {
  switch (f) {
    case "description":
      return "Description";
    case "aliases":
      return "Aliases";
    case "primaryEntity":
      return "Primary entity";
    case "tags":
      return "Tags";
    case "sensitive":
      return "Sensitive";
    case "commonQueryLanguage":
      return "Common language";
    case "exampleQuestions":
      return "Examples";
  }
}

function fieldDisplay(f: FieldId, d: TableDraft, t: V2Table): string {
  switch (f) {
    case "description":
      return d.description;
    case "aliases":
      return formatList(d.aliases);
    case "primaryEntity":
      return d.primaryEntity ?? "";
    case "tags":
      return formatList(d.tags);
    case "sensitive":
      return (d.sensitive ?? t.sensitive ?? false) ? "yes" : "no";
    case "commonQueryLanguage":
      return d.commonQueryLanguage ?? "";
    case "exampleQuestions":
      return d.exampleQuestions ?? "";
  }
}

function applyTableEdit(f: FieldId, d: TableDraft, text: string): TableDraft {
  const next = { ...d };
  switch (f) {
    case "description":
      next.description = text;
      break;
    case "aliases":
      next.aliases = parseListInput(text);
      break;
    case "primaryEntity":
      next.primaryEntity = text.trim() || undefined;
      break;
    case "tags":
      next.tags = parseListInput(text);
      break;
    case "sensitive":
      // Toggled in place.
      break;
    case "commonQueryLanguage":
      next.commonQueryLanguage = text;
      break;
    case "exampleQuestions":
      next.exampleQuestions = text;
      break;
  }
  return next;
}

type FieldRowProps = {
  label: string;
  value: string;
  active: boolean;
  editing: boolean;
  multiline: boolean;
  onSubmit: (text: string) => void;
  onCancel: () => void;
};

function FieldRow({
  label,
  value,
  active,
  editing,
  multiline,
  onSubmit,
  onCancel,
}: FieldRowProps): JSX.Element {
  return (
    <Box>
      <Box width={16}>
        <Text color={active ? "cyan" : undefined}>
          {active ? "▶ " : "  "}
          {label}
        </Text>
      </Box>
      <Box flexGrow={1}>
        {editing ? (
          <TextInput
            initialValue={value}
            multiline={multiline}
            onSubmit={onSubmit}
            onCancel={onCancel}
          />
        ) : (
          <Text>{value || <Text dimColor>(none)</Text>}</Text>
        )}
      </Box>
    </Box>
  );
}
