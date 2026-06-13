import { Box, Text, useInput, useStdout } from "ink";
import type { JSX } from "react";
import type { Workspace } from "@askdb/enrich";

type TableListProps = {
  workspace: Workspace;
  selectedIndex: number;
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
};

// Rows consumed by chrome: 2 borders + title + schemaId + marginTop + marginTop-footer + footer
const CHROME_ROWS = 7;

export function TableList({
  workspace,
  selectedIndex,
  onSelect,
  onOpen,
}: TableListProps): JSX.Element {
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows ?? 24;

  useInput((_input, key) => {
    if (key.upArrow) {
      onSelect(Math.max(0, selectedIndex - 1));
    } else if (key.downArrow) {
      onSelect(Math.min(workspace.tables.length - 1, selectedIndex + 1));
    } else if (key.return) {
      onOpen(selectedIndex);
    }
  });

  const total = workspace.tables.length;
  // Reserve 2 extra rows for scroll indicators when needed
  const maxVisible = Math.max(1, terminalHeight - CHROME_ROWS - 2);
  const needsScroll = total > maxVisible;

  let viewStart = 0;
  if (needsScroll) {
    viewStart = Math.max(0, selectedIndex - Math.floor(maxVisible / 2));
    viewStart = Math.min(viewStart, total - maxVisible);
  }
  const viewEnd = Math.min(total, viewStart + maxVisible);

  const visibleTables = workspace.tables.slice(viewStart, viewEnd);
  const hasAbove = viewStart > 0;
  const hasBelow = viewEnd < total;

  return (
    <Box flexDirection="column" width={28} borderStyle="single" paddingX={1}>
      <Text bold>Tables ({workspace.tables.length})</Text>
      <Text dimColor>{workspace.physical.schemaId}</Text>
      <Box marginTop={1} flexDirection="column">
        {hasAbove ? <Text dimColor>↑ {viewStart} more</Text> : null}
        {visibleTables.map((t, vi) => {
          const i = viewStart + vi;
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
        {hasBelow ? <Text dimColor>↓ {total - viewEnd} more</Text> : null}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓ select · ⏎ open · c concepts · q quit</Text>
      </Box>
    </Box>
  );
}
