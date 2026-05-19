import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { V2Concept } from "@askdb/core";
import { parseListInput } from "@askdb/enrich";
import { saveConcepts, type Workspace } from "@askdb/enrich";
import { TextInput } from "./TextInput.js";

type ConceptsEditProps = {
  workspace: Workspace;
  onBack: () => void;
};

type AddField = "id" | "label" | "synonyms" | "links" | "description";
const ADD_FIELDS: AddField[] = ["id", "label", "synonyms", "links", "description"];

export function ConceptsEdit({ workspace, onBack }: ConceptsEditProps): JSX.Element {
  const [concepts, setConcepts] = useState<V2Concept[]>(() => [
    ...(workspace.concepts?.frontmatter.concepts ?? []),
  ]);
  const [adding, setAdding] = useState(false);
  const [fieldIndex, setFieldIndex] = useState(0);
  const [draft, setDraft] = useState<Partial<Record<AddField, string>>>({});
  const [message, setMessage] = useState<string | null>(null);

  useInput((input, key) => {
    if (adding) return;
    if (input === "a") {
      setAdding(true);
      setFieldIndex(0);
      setDraft({});
      setMessage(null);
    } else if (input === "s") {
      try {
        saveConcepts(workspace, { concepts });
        setMessage("Saved");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    } else if (input === "b" || key.escape) onBack();
  });

  const currentField = ADD_FIELDS[fieldIndex]!;

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="single" paddingX={1}>
      <Text bold>Concepts</Text>
      <Text dimColor>{workspace.physical.schemaId}</Text>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          Concepts map business vocabulary to your schema so the AI can translate natural
          language into correct SQL. Each concept has an id, a human-readable label,
          optional synonyms users might say, links to tables/columns, and a description.
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {concepts.length === 0 ? (
          <Text dimColor>(none — press a to add your first concept)</Text>
        ) : (
          concepts.map((concept) => (
            <Text key={concept.id}>
              <Text color="cyan">{concept.id}</Text> {concept.label}
              {concept.synonyms?.length ? <Text dimColor> [{concept.synonyms.join(", ")}]</Text> : null}
              {concept.links?.length ? <Text dimColor> → {concept.links.join(", ")}</Text> : null}
            </Text>
          ))
        )}
      </Box>

      {adding ? (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Add concept — {fieldLabel(currentField)}</Text>
          <Text dimColor>{fieldHint(currentField, workspace)}</Text>
          <TextInput
            key={currentField}
            multiline={currentField === "description"}
            placeholder={fieldPlaceholder(currentField)}
            onSubmit={(value) => {
              const nextDraft = { ...draft, [currentField]: value };
              if (fieldIndex < ADD_FIELDS.length - 1) {
                setDraft(nextDraft);
                setFieldIndex(fieldIndex + 1);
                return;
              }
              const concept = buildConcept(nextDraft);
              setConcepts((prev) => [...prev, concept]);
              setAdding(false);
              setMessage("Concept queued; press s to save");
            }}
            onCancel={() => setAdding(false)}
          />
        </Box>
      ) : null}

      {message ? (
        <Box marginTop={1}>
          <Text color={message === "Saved" ? "green" : "yellow"}>{message}</Text>
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text dimColor>
          {adding ? "enter · next field · Ctrl-D submit (description) · Esc cancel" : "a add · s save · b back"}
        </Text>
      </Box>
    </Box>
  );
}

function buildConcept(draft: Partial<Record<AddField, string>>): V2Concept {
  const concept: V2Concept = {
    id: (draft.id ?? "").trim(),
    label: (draft.label ?? "").trim(),
  };
  const synonyms = parseListInput(draft.synonyms ?? "");
  const links = parseListInput(draft.links ?? "");
  const description = (draft.description ?? "").trim();
  if (synonyms.length) concept.synonyms = synonyms;
  if (links.length) concept.links = links;
  if (description) concept.description = description;
  return concept;
}

function fieldLabel(field: AddField): string {
  switch (field) {
    case "id":
      return "ID";
    case "label":
      return "Label";
    case "synonyms":
      return "Synonyms";
    case "links":
      return "Links";
    case "description":
      return "Description";
  }
}

function fieldHint(field: AddField, workspace: Workspace): string {
  const sampleTable = workspace.physical.tables[0];
  const sampleTableId = sampleTable?.id ?? "table:public.orders";
  const sampleColumnId = sampleTable?.columns[0]
    ? `${sampleTableId}#${sampleTable.columns[0].name}`
    : `${sampleTableId}#total_amount`;
  switch (field) {
    case "id":
      return 'Unique identifier prefixed with "concept:", e.g. concept:revenue or concept:customer';
    case "label":
      return 'Human-readable name shown in prompts, e.g. Revenue or Active Customer';
    case "synonyms":
      return `Comma-separated terms users might ask about, e.g. sales, gross sales, top line — leave blank to skip`;
    case "links":
      return `Comma-separated table or column IDs from this schema, e.g. ${sampleTableId} or ${sampleColumnId} — leave blank to skip`;
    case "description":
      return "How this concept is computed or what it means, e.g. Sum of orders.total_amount where status = 'paid'. Press Ctrl-D to submit.";
  }
}

function fieldPlaceholder(field: AddField): string {
  switch (field) {
    case "id":
      return "concept:revenue";
    case "label":
      return "Revenue";
    case "synonyms":
      return "sales, gross sales, top line";
    case "links":
      return "table:public.orders#total_amount";
    case "description":
      return "Sum of orders.total_amount where status = 'paid'";
  }
}
