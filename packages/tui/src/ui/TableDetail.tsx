import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { ParsedTableMarkdown, V2Table } from "@askdb/core";
import { TextInput } from "./TextInput.js";

type Mode = "view" | "edit-description";

type TableDetailProps = {
  physical: V2Table;
  parsed: ParsedTableMarkdown | undefined;
  /** Current draft description (the first paragraph of the body). */
  description: string;
  saved: boolean;
  onEditDescription: (next: string) => void;
  onSaveDescription: () => void;
  onBack: () => void;
};

export function TableDetail({
  physical,
  parsed,
  description,
  saved,
  onEditDescription,
  onSaveDescription,
  onBack,
}: TableDetailProps): JSX.Element {
  const [mode, setMode] = useState<Mode>("view");

  useInput((input, key) => {
    if (mode !== "view") return;
    if (input === "e") {
      setMode("edit-description");
    } else if (input === "s") {
      onSaveDescription();
    } else if (input === "b" || key.escape) {
      onBack();
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="single" paddingX={1}>
      <Text bold>{physical.name}</Text>
      <Text dimColor>
        {physical.schema}.{physical.name} · {physical.columns.length} columns
        {physical.sensitive ? " · sensitive" : ""}
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text bold>Description</Text>
        {mode === "edit-description" ? (
          <TextInput
            initialValue={description}
            multiline
            placeholder="Describe what this table holds (Ctrl-D to submit, Esc to cancel)…"
            onSubmit={(next) => {
              onEditDescription(next);
              setMode("view");
            }}
            onCancel={() => setMode("view")}
          />
        ) : (
          <Text>{description || <Text dimColor>(none)</Text>}</Text>
        )}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>Columns</Text>
        {physical.columns.map((c) => (
          <Text key={c.id}>
            {" - "}
            {c.name}
            <Text dimColor> {c.type}</Text>
            {c.primaryKey ? <Text color="cyan"> [pk]</Text> : null}
            {c.sensitive ? <Text color="yellow"> [sensitive]</Text> : null}
          </Text>
        ))}
      </Box>

      {parsed === undefined ? (
        <Box marginTop={1}>
          <Text color="yellow">No tables/{physical.name}.md yet — saving will create it.</Text>
        </Box>
      ) : null}

      {saved ? (
        <Box marginTop={1}>
          <Text color="green">✓ Saved</Text>
        </Box>
      ) : null}

      {mode === "view" ? (
        <Box marginTop={1}>
          <Text dimColor>e edit description · s save · b back</Text>
        </Box>
      ) : null}
    </Box>
  );
}
