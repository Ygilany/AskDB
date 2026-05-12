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
        {concepts.length === 0 ? (
          <Text dimColor>(none)</Text>
        ) : (
          concepts.map((concept) => (
            <Text key={concept.id}>
              <Text color="cyan">{concept.id}</Text> {concept.label}
              {concept.links?.length ? <Text dimColor> → {concept.links.join(", ")}</Text> : null}
            </Text>
          ))
        )}
      </Box>

      {adding ? (
        <Box marginTop={1} flexDirection="column">
          <Text>Add concept: {fieldLabel(currentField)}</Text>
          <TextInput
            key={currentField}
            multiline={currentField === "description"}
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
          {adding ? "enter field · Esc cancel" : "a add · s save · b back"}
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
      return "id";
    case "label":
      return "label";
    case "synonyms":
      return "synonyms (comma-separated)";
    case "links":
      return "links (comma-separated table/column ids)";
    case "description":
      return "description";
  }
}
