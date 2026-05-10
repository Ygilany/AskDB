import { Box, Text, useInput } from "ink";
import type { Workspace } from "../workspace.js";

type TableListProps = {
  workspace: Workspace;
  selectedIndex: number;
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
};

export function TableList({
  workspace,
  selectedIndex,
  onSelect,
  onOpen,
}: TableListProps): JSX.Element {
  useInput((_input, key) => {
    if (key.upArrow) {
      onSelect(Math.max(0, selectedIndex - 1));
    } else if (key.downArrow) {
      onSelect(Math.min(workspace.tables.length - 1, selectedIndex + 1));
    } else if (key.return) {
      onOpen(selectedIndex);
    }
  });

  return (
    <Box flexDirection="column" width={28} borderStyle="single" paddingX={1}>
      <Text bold>Tables ({workspace.tables.length})</Text>
      <Text dimColor>{workspace.physical.schemaId}</Text>
      <Box marginTop={1} flexDirection="column">
        {workspace.tables.map((t, i) => {
          const selected = i === selectedIndex;
          const undescribed = !t.parsed;
          return (
            <Text key={t.physical.id}>
              <Text color={selected ? "cyan" : undefined}>
                {selected ? "▶ " : "  "}
                {t.physical.name}
              </Text>
              {undescribed ? <Text color="yellow"> (new)</Text> : null}
            </Text>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓ select · ⏎ open · q quit</Text>
      </Box>
    </Box>
  );
}
