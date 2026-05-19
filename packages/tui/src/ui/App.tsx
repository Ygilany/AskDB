import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useState } from "react";
import {
  buildDefaultTableBody,
  pruneOrphanedColumns,
  replaceH2Section,
  replaceTableDescription,
  saveTable,
  type Workspace,
} from "@askdb/enrich";
import {
  buildFrontmatter,
  buildTableDraft,
  parseListInput,
  type TableDraft,
} from "@askdb/enrich";
import {
  buildSuggestionContext,
  buildSuggestionTarget,
  type SuggestEnrichmentForTui,
  type SuggestSource,
  type TableSuggestField,
} from "@askdb/enrich";
import { ColumnEdit } from "./ColumnEdit.js";
import { ConceptsEdit } from "./ConceptsEdit.js";
import { SuggestionReview } from "./SuggestionReview.js";
import { TableDetail } from "./TableDetail.js";
import { TableList } from "./TableList.js";

type AppProps = {
  workspace: Workspace;
  suggest?: SuggestEnrichmentForTui;
};

type Screen =
  | { kind: "list" }
  | { kind: "table" }
  | { kind: "column"; columnId: string }
  | { kind: "concepts" };

export function App({ workspace, suggest }: AppProps): JSX.Element {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>({ kind: "list" });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, TableDraft>>(() =>
    buildInitialDrafts(workspace),
  );
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [warningCount, setWarningCount] = useState(workspace.warnings.length);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [review, setReview] = useState<{
    source: SuggestSource;
    title: string;
    candidates: Array<{ text: string }>;
  } | null>(null);

  const current = workspace.tables[selectedIndex];
  const draft = current ? drafts[current.physical.id]! : undefined;
  const showSaved = current ? savedFlash === current.physical.id : false;

  useInput((input) => {
    if (screen.kind === "list" && input === "q") exit();
    else if (screen.kind === "list" && input === "c") setScreen({ kind: "concepts" });
    else if (screen.kind === "list" && input === "p") {
      pruneOrphanedColumns(workspace);
      setWarningCount(workspace.warnings.length);
    }
  });

  const updateDraft = (next: TableDraft) => {
    if (!current) return;
    setDrafts((prev) => ({ ...prev, [current.physical.id]: next }));
    setSavedFlash(null);
  };

  const handleSave = () => {
    if (!current || !draft) return;
    const fm = buildFrontmatter(current.physical, workspace.physical.schemaId, draft);
    let body = current.parsed
      ? replaceTableDescription(current.parsed.body, draft.description)
      : buildDefaultTableBody(current.physical.name, draft.description);
    if (draft.commonQueryLanguage !== undefined) {
      body = replaceH2Section(body, "Common query language", draft.commonQueryLanguage);
    }
    if (draft.exampleQuestions !== undefined) {
      body = replaceH2Section(body, "Example questions", draft.exampleQuestions);
    }
    saveTable(workspace, current.physical.id, fm, body);
    setSavedFlash(current.physical.id);
  };

  const requestSuggestion = async (source: SuggestSource, title: string) => {
    if (!suggest) {
      setSuggestError("AI suggestions are not configured. Set OPENAI_API_KEY in the CLI.");
      return;
    }
    setSuggesting(true);
    setSuggestError(null);
    try {
      const target = buildSuggestionTarget(workspace, source);
      const context = buildSuggestionContext(workspace, source.tableId);
      const candidates = await suggest(target, context);
      if (candidates.length === 0) {
        setSuggestError("No suggestions returned.");
        return;
      }
      setReview({ source, title, candidates });
    } catch (error) {
      setSuggestError(error instanceof Error ? error.message : String(error));
    } finally {
      setSuggesting(false);
    }
  };

  const applySuggestion = (source: SuggestSource, text: string) => {
    const next = applySuggestionToDraft(drafts[source.tableId]!, source, text);
    setDrafts((prev) => ({ ...prev, [source.tableId]: next }));
    setSavedFlash(null);
    setReview(null);
  };

  if (review) {
    return (
      <Box flexDirection="row">
        <StaticTableList workspace={workspace} selectedIndex={selectedIndex} />
        <SuggestionReview
          title={review.title}
          candidates={review.candidates}
          onAccept={(text) => applySuggestion(review.source, text)}
          onReject={() => setReview(null)}
        />
      </Box>
    );
  }

  if (screen.kind === "concepts") {
    return (
      <Box flexDirection="row">
        <StaticTableList workspace={workspace} selectedIndex={selectedIndex} />
        <ConceptsEdit workspace={workspace} onBack={() => setScreen({ kind: "list" })} />
      </Box>
    );
  }

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
          {warningCount > 0 ? (
            <Box marginTop={1} flexDirection="column">
              <Text color="yellow">{warningCount} schema warning(s)</Text>
              <Text dimColor>p prune orphaned columns · open tables for new column prompts</Text>
            </Box>
          ) : null}
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
          onSuggestField={(field) =>
            requestSuggestion(
              {
                scope: "column",
                tableId: current.physical.id,
                columnId: col.id,
                field,
              },
              `${current.physical.name}.${col.name} ${field}`,
            )
          }
          onBack={() => setScreen({ kind: "table" })}
          suggesting={suggesting}
          suggestError={suggestError}
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
        onSuggestField={(field) =>
          requestSuggestion(
            { scope: "table", tableId: current.physical.id, field },
            `${current.physical.name} ${formatTableSuggestField(field)}`,
          )
        }
        onOpenColumn={(columnId) => setScreen({ kind: "column", columnId })}
        onBack={() => setScreen({ kind: "list" })}
        suggesting={suggesting}
        suggestError={suggestError}
        missingColumnIds={new Set(
          workspace.warnings
            .filter(
              (w): w is Extract<(typeof workspace.warnings)[number], { kind: "missing_column_md" }> =>
                w.kind === "missing_column_md" && w.tableId === current.physical.id,
            )
            .map((w) => w.columnId),
        )}
      />
    </Box>
  );
}

function applySuggestionToDraft(
  draft: TableDraft,
  source: SuggestSource,
  text: string,
): TableDraft {
  if (source.scope === "table") {
    switch (source.field) {
      case "description":
        return { ...draft, description: text };
      case "aliases":
        return { ...draft, aliases: parseListInput(text) };
      case "primaryEntity":
        return { ...draft, primaryEntity: text.trim() || undefined };
      case "commonQueryLanguage":
        return { ...draft, commonQueryLanguage: text };
    }
  }

  const columnDraft = draft.columns[source.columnId] ?? {};
  const nextColumn =
    source.field === "aliases"
      ? { ...columnDraft, aliases: parseListInput(text) }
      : { ...columnDraft, description: text };
  return {
    ...draft,
    columns: {
      ...draft.columns,
      [source.columnId]: nextColumn,
    },
  };
}

function formatTableSuggestField(field: TableSuggestField): string {
  switch (field) {
    case "description":
      return "description";
    case "aliases":
      return "aliases";
    case "primaryEntity":
      return "primary entity";
    case "commonQueryLanguage":
      return "common query language";
  }
}

function buildInitialDrafts(workspace: Workspace): Record<string, TableDraft> {
  const out: Record<string, TableDraft> = {};
  for (const t of workspace.tables) {
    out[t.physical.id] = buildTableDraft(t.physical, t.parsed);
  }
  return out;
}

const STATIC_CHROME_ROWS = 6; // 2 borders + title + schemaId + marginTop + bottom border

function StaticTableList({
  workspace,
  selectedIndex,
}: {
  workspace: Workspace;
  selectedIndex: number;
}): JSX.Element {
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows ?? 24;

  const total = workspace.tables.length;
  const maxVisible = Math.max(1, terminalHeight - STATIC_CHROME_ROWS - 2);
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
          return (
            <Text key={t.physical.id}>
              <Text color={i === selectedIndex ? "cyan" : undefined}>
                {i === selectedIndex ? "▶ " : "  "}
                {t.physical.name}
              </Text>
            </Text>
          );
        })}
        {hasBelow ? <Text dimColor>↓ {total - viewEnd} more</Text> : null}
      </Box>
    </Box>
  );
}
