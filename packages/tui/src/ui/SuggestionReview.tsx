import { Box, Text, useInput } from "ink";
import { useState, type JSX } from "react";
import type { EnrichmentCandidate } from "@askdb/core";
import { TextInput } from "./TextInput.js";

type SuggestionReviewProps = {
  title: string;
  candidates: EnrichmentCandidate[];
  onAccept: (text: string) => void;
  onReject: () => void;
};

export function SuggestionReview({
  title,
  candidates,
  onAccept,
  onReject,
}: SuggestionReviewProps): JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const selected = candidates[selectedIndex]?.text ?? "";

  useInput((input, key) => {
    if (editing) return;
    if (key.upArrow) setSelectedIndex(Math.max(0, selectedIndex - 1));
    else if (key.downArrow) {
      setSelectedIndex(Math.min(candidates.length - 1, selectedIndex + 1));
    } else if (key.return || input === "a") onAccept(selected);
    else if (input === "e") setEditing(true);
    else if (input === "r" || key.escape) onReject();
  });

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="single" paddingX={1}>
      <Text bold>Suggestion: {title}</Text>
      <Box marginTop={1} flexDirection="column">
        {editing ? (
          <TextInput
            initialValue={selected}
            multiline={selected.includes("\n")}
            onSubmit={onAccept}
            onCancel={() => setEditing(false)}
          />
        ) : (
          candidates.map((candidate, i) => (
            <Text key={`${i}-${candidate.text}`}>
              <Text color={i === selectedIndex ? "cyan" : undefined}>
                {i === selectedIndex ? "▶ " : "  "}
              </Text>
              {candidate.text}
            </Text>
          ))
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {editing
            ? "edit suggestion · ⏎ accept · Esc cancel"
            : "↑↓ choose · ⏎/a accept · e edit · r reject"}
        </Text>
      </Box>
    </Box>
  );
}
