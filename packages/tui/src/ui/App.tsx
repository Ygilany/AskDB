import { Box, Text, useApp, useInput } from "ink";
import { useState } from "react";
import {
  buildDefaultTableBody,
  replaceTableDescription,
  saveTable,
  type Workspace,
} from "../workspace.js";
import { buildFrontmatter, buildTableDraft, type TableDraft } from "../draft.js";
import { ColumnEdit } from "./ColumnEdit.js";
import { TableDetail } from "./TableDetail.js";
import { TableList } from "./TableList.js";

type AppProps = {
  workspace: Workspace;
};

type Screen =
  | { kind: "list" }
  | { kind: "table" }
  | { kind: "column"; columnId: string };

export function App({ workspace }: AppProps): JSX.Element {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>({ kind: "list" });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, TableDraft>>(() =>
    buildInitialDrafts(workspace),
  );
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  const current = workspace.tables[selectedIndex];
  const draft = current ? drafts[current.physical.id]! : undefined;
  const showSaved = current ? savedFlash === current.physical.id : false;

  useInput((input) => {
    if (screen.kind === "list" && input === "q") exit();
  });

  const updateDraft = (next: TableDraft) => {
    if (!current) return;
    setDrafts((prev) => ({ ...prev, [current.physical.id]: next }));
    setSavedFlash(null);
  };

  const handleSave = () => {
    if (!current || !draft) return;
    const fm = buildFrontmatter(current.physical, workspace.physical.schemaId, draft);
    const body = current.parsed
      ? replaceTableDescription(current.parsed.body, draft.description)
      : buildDefaultTableBody(current.physical.name, draft.description);
    saveTable(workspace, current.physical.id, fm, body);
    setSavedFlash(current.physical.id);
  };

  if (screen.kind === "list" || !current || !draft) {
    return (
      <Box flexDirection="row">
        <TableList
          workspace={workspace}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
          onOpen={(i) => {
            setSelectedIndex(i);
            setScreen({ kind: "table" });
          }}
        />
        <Box flexDirection="column" paddingX={2} paddingY={1}>
          <Text bold>AskDB TUI</Text>
          <Text dimColor>Schema: {workspace.physical.schemaId}</Text>
          <Text dimColor>Path:   {workspace.schemaDir}</Text>
          <Box marginTop={1}>
            <Text>Select a table on the left and press Enter.</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  if (screen.kind === "column") {
    const col = current.physical.columns.find((c) => c.id === screen.columnId);
    if (!col) {
      setScreen({ kind: "table" });
      return <Text>Loading…</Text>;
    }
    return (
      <Box flexDirection="row">
        <TableList
          workspace={workspace}
          selectedIndex={selectedIndex}
          onSelect={(i) => {
            setSelectedIndex(i);
            setSavedFlash(null);
            setScreen({ kind: "table" });
          }}
          onOpen={(i) => {
            setSelectedIndex(i);
            setScreen({ kind: "table" });
          }}
        />
        <ColumnEdit
          column={col}
          draft={draft.columns[col.id] ?? {}}
          saved={showSaved}
          onChange={(next) =>
            updateDraft({
              ...draft,
              columns: { ...draft.columns, [col.id]: next },
            })
          }
          onSave={handleSave}
          onBack={() => setScreen({ kind: "table" })}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <TableList
        workspace={workspace}
        selectedIndex={selectedIndex}
        onSelect={(i) => {
          setSelectedIndex(i);
          setSavedFlash(null);
        }}
        onOpen={(i) => {
          setSelectedIndex(i);
          setScreen({ kind: "table" });
        }}
      />
      <TableDetail
        key={current.physical.id}
        physical={current.physical}
        draft={draft}
        saved={showSaved}
        onChange={updateDraft}
        onSave={handleSave}
        onOpenColumn={(columnId) => setScreen({ kind: "column", columnId })}
        onBack={() => setScreen({ kind: "list" })}
      />
    </Box>
  );
}

function buildInitialDrafts(workspace: Workspace): Record<string, TableDraft> {
  const out: Record<string, TableDraft> = {};
  for (const t of workspace.tables) {
    out[t.physical.id] = buildTableDraft(t.physical, t.parsed);
  }
  return out;
}
