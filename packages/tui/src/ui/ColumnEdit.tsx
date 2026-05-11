import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { V2Column } from "@askdb/core";
import {
  formatList,
  isEnumCandidate,
  parseListInput,
  type ColumnDraft,
} from "../draft.js";
import type { ColumnSuggestField } from "../suggest.js";
import { TextInput } from "./TextInput.js";

type ColumnEditProps = {
  column: V2Column;
  draft: ColumnDraft;
  saved: boolean;
  onChange: (next: ColumnDraft) => void;
  onSave: () => void;
  onSuggestField?: (field: ColumnSuggestField) => void;
  onBack: () => void;
  suggesting?: boolean;
  suggestError?: string | null;
};

type FieldId = "description" | "aliases" | "enum" | "sensitive";

export function ColumnEdit({
  column,
  draft,
  saved,
  onChange,
  onSave,
  onSuggestField,
  onBack,
  suggesting = false,
  suggestError = null,
}: ColumnEditProps): JSX.Element {
  const fields = buildFields(column);
  const [activeIdx, setActiveIdx] = useState(0);
  const [editing, setEditing] = useState<FieldId | null>(null);

  useInput((input, key) => {
    if (editing) return;
    if (key.upArrow) setActiveIdx(Math.max(0, activeIdx - 1));
    else if (key.downArrow) setActiveIdx(Math.min(fields.length - 1, activeIdx + 1));
    else if (key.return) {
      const f = fields[activeIdx]!;
      if (f === "sensitive") {
        const current = draft.sensitive ?? column.sensitive ?? false;
        onChange({ ...draft, sensitive: !current });
      } else {
        setEditing(f);
      }
    } else if (input === "s") onSave();
    else if (input === "g") {
      const f = fields[activeIdx]!;
      if (isSuggestableColumnField(f)) onSuggestField?.(f);
    }
    else if (input === "b" || key.escape) onBack();
  });

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="single" paddingX={1}>
      <Text bold>
        {column.name} <Text dimColor>({column.type})</Text>
      </Text>
      <Box marginTop={1} flexDirection="column">
        {fields.map((f, i) => (
          <FieldRow
            key={f}
            id={f}
            label={fieldLabel(f)}
            value={fieldDisplay(f, draft, column)}
            active={i === activeIdx && editing === null}
            editing={editing === f}
            multiline={f === "description"}
            onSubmit={(text) => {
              onChange(applyEdit(f, draft, text));
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        ))}
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
            : "↑↓ field · ⏎ edit/toggle · g suggest · s save · b back"}
        </Text>
      </Box>
    </Box>
  );
}

function isSuggestableColumnField(f: FieldId): f is ColumnSuggestField {
  return f === "description" || f === "aliases";
}

function buildFields(col: V2Column): FieldId[] {
  const out: FieldId[] = ["description", "aliases"];
  if (isEnumCandidate(col)) out.push("enum");
  out.push("sensitive");
  return out;
}

function fieldLabel(f: FieldId): string {
  switch (f) {
    case "description":
      return "Description";
    case "aliases":
      return "Aliases";
    case "enum":
      return "Enum values";
    case "sensitive":
      return "Sensitive";
  }
}

function fieldDisplay(f: FieldId, d: ColumnDraft, col: V2Column): string {
  switch (f) {
    case "description":
      return d.description ?? "";
    case "aliases":
      return formatList(d.aliases);
    case "enum":
      return formatList(d.enum);
    case "sensitive":
      return (d.sensitive ?? col.sensitive ?? false) ? "yes" : "no";
  }
}

function applyEdit(f: FieldId, d: ColumnDraft, text: string): ColumnDraft {
  const next = { ...d };
  switch (f) {
    case "description":
      next.description = text;
      break;
    case "aliases":
      next.aliases = parseListInput(text);
      break;
    case "enum":
      next.enum = parseListInput(text);
      break;
    case "sensitive":
      // Toggled in place; no text edit path.
      break;
  }
  return next;
}

type FieldRowProps = {
  id: FieldId;
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
      <Box width={14}>
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
