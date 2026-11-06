import { askCommand, runAskCli } from "./ask.js";
import { bundleCommand, runBundleCli } from "./bundle.js";
import { formatOptionSections, GENERAL_OPTION_LINES } from "./command.js";
import { labelled } from "./error-values.js";
import { initCommand, runInitCli } from "./init.js";
import { introspectCommand, runIntrospectCli } from "./introspect.js";
import { ragCommand, runRagCli } from "./rag.js";
import { readCliVersion } from "./version.js";

/** A command `askdb` dispatches to: its name, its line in `askdb --help`, and its entry. */
type CliCommand = { name: string; summary: string; run(argv: readonly string[]): Promise<number> };

async function runStudio(argv: readonly string[]): Promise<number> {
  // Studio owns config loading and its own help: a missing config opens the setup wizard.
  const { runStudioBin } = await import("@askdb/studio");
  return runStudioBin(argv);
}

export const COMMANDS: readonly CliCommand[] = [
  { name: "init", summary: initCommand().summary, run: (argv) => runInitCli(argv) },
  { name: "introspect", summary: introspectCommand().summary, run: (argv) => runIntrospectCli(argv) },
  { name: "studio", summary: "Start the local browser UI for Schema v2 enrichment", run: runStudio },
  { name: "enrich", summary: "Open Studio for Schema v2 enrichment (alias of `askdb studio`)", run: runStudio },
  { name: "bundle", summary: bundleCommand().summary, run: runBundleCli },
  { name: "ask", summary: askCommand().summary, run: runAskCli },
  { name: "rag", summary: ragCommand().summary, run: runRagCli },
];

function formatTopLevelHelp(): string {
  return [
    "AskDB — natural language → validated SQL for your database",
    "",
    "Usage:",
    "  askdb <command> [options]",
    "  askdb help <command>       Same as askdb <command> --help",
    "",
    ...formatOptionSections(
      new Map([
        ["Commands", COMMANDS.map((command) => ({ usage: command.name, help: command.summary }))],
        ["Options", GENERAL_OPTION_LINES],
      ]),
    ),
  ].join("\n");
}

/**
 * `askdb <command> …`, `askdb help <command>`, `--help` and `--version`. Returns the exit code.
 * With no command, prints the help to stderr and returns 1.
 */
export async function runCli(argv: readonly string[]): Promise<number> {
  const [first, ...rest] = argv;
  if (first === undefined) {
    process.stderr.write(formatTopLevelHelp());
    return 1;
  }
  if (first === "--help" || first === "-h" || (first === "help" && rest.length === 0)) {
    process.stdout.write(formatTopLevelHelp());
    return 0;
  }
  if (first === "--version" || first === "-V") {
    process.stdout.write(`${readCliVersion()}\n`);
    return 0;
  }
  if (first === "help") return runCli([rest[0]!, "--help"]);
  const command = COMMANDS.find((candidate) => candidate.name === first);
  if (!command) {
    const kind = first.startsWith("-") ? "Unknown option" : "Unknown command";
    process.stderr.write(`${labelled(kind, first)}. Run \`askdb --help\` for the commands.\n`);
    return 1;
  }
  return command.run(rest);
}
