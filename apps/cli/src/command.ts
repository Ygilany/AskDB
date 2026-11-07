import { errorMessage } from "./cli-error.js";
import { labelled } from "./error-values.js";
import { requireAskDbConfig } from "./project-config.js";
import { readCliVersion } from "./version.js";

/** One flag of a command: how it's spelt, how it shows in the help, and what it sets. */
export type Flag<O> = {
  /** Spellings, short form first: `["-f", "--force"]`. */
  names: readonly string[];
  /** Placeholder for the flag's value, e.g. `<dir>`; absent for a switch. */
  value?: string;
  /** The help line; a function when it depends on something the command is built with. */
  help: string | (() => string);
  /** The help section, e.g. `Database options`. Absent: `Options`. */
  group?: string;
  /** Sets the flag on `opts`. A bad value throws; the error repeats it only when `showable()`. */
  apply(opts: O, value: string): void;
};

/** Everything `runCommand` needs to parse, document, gate and run one `askdb` command. */
export type CommandSpec<O> = {
  name: string;
  /** One line, for the top of the command's help and for `askdb --help`. */
  summary: string;
  /** Usage lines, each starting `askdb <name>`. */
  usage: readonly string[];
  /** Lines printed between the usage and the options. */
  notes?: readonly string[];
  flags: readonly Flag<O>[];
  /**
   * Takes the `index`th argument that isn't a flag. Absent: the command takes none. Throws for
   * one it doesn't take, without repeating it.
   */
  positional?(opts: O, value: string, index: number): void;
  /** Options before any flag is applied. */
  initial(): O;
  /** Conflicts between flags, after every flag is applied. Throws a usage error. */
  check?(opts: O): void;
  /** Whether this run reads askdb.config. */
  needsConfig(opts: O): boolean;
  run(opts: O): Promise<number>;
};

/**
 * ADR 0030, which keeps Studio and RAG at 0.x: the help of their experimental surfaces links it.
 * A minor release of `askdb` may change those surfaces.
 */
export const EXPERIMENTAL_ADR_URL = "https://github.com/Ygilany/AskDB/blob/main/docs/adrs/0030-1-0-promises-checked-sql-only.md";

/** The spellings every command, and `askdb` itself, takes for its help and its version. */
export const HELP_FLAGS: readonly string[] = ["--help", "-h"];
export const VERSION_FLAGS: readonly string[] = ["--version", "-V"];

/** The help and version lines every command takes. `askdb --help` lists them too. */
export const GENERAL_OPTION_LINES: readonly OptionLine[] = [
  { usage: "-V, --version", help: "Print the askdb version." },
  { usage: "-h, --help", help: "Print this help." },
];

type OptionLine = { usage: string; help: string };

/**
 * Runs one command: `--help`/`-h` and `--version`/`-V` first, anywhere in `argv`; then the flags,
 * positionals and `check`; then the config gate; then `run`. A usage error or an error `run`
 * throws goes to stderr and returns 1. The config gate's error propagates, so the top-level
 * handler prints it with its debug hint.
 */
export async function runCommand<O>(spec: CommandSpec<O>, argv: readonly string[]): Promise<number> {
  if (argv.some((arg) => HELP_FLAGS.includes(arg))) {
    process.stdout.write(formatHelp(spec));
    return 0;
  }
  if (argv.some((arg) => VERSION_FLAGS.includes(arg))) {
    process.stdout.write(`${readCliVersion()}\n`);
    return 0;
  }
  let opts: O;
  try {
    opts = parseArgs(spec, argv);
    spec.check?.(opts);
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    return 1;
  }
  if (spec.needsConfig(opts)) requireAskDbConfig();
  try {
    return await spec.run(opts);
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    return 1;
  }
}

function parseArgs<O>(spec: CommandSpec<O>, argv: readonly string[]): O {
  const byName = new Map(spec.flags.flatMap((flag) => flag.names.map((name) => [name, flag] as const)));
  const opts = spec.initial();
  let positionals = 0;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    // Errors never repeat an argument whole: it can be a connection string, password included.
    if (!arg.startsWith("-")) {
      if (!spec.positional) {
        throw new Error(
          `Unexpected argument: askdb ${spec.name} takes no positional arguments. Pass values with their flag.`,
        );
      }
      spec.positional(opts, arg, positionals);
      positionals += 1;
      continue;
    }
    // `--flag=value` works like `--flag value`.
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    const flag = byName.get(name);
    if (flag) {
      if (!flag.value) {
        if (inline !== undefined) throw new Error(`${name} takes no value.`);
        flag.apply(opts, "");
      } else if (inline !== undefined) {
        if (!inline) throw new Error(`${name} requires a value.`);
        flag.apply(opts, inline);
      } else {
        flag.apply(opts, readValue(argv, ++i, name));
      }
      continue;
    }
    if (arg.startsWith("--") || arg.length < 3) throw new Error(labelled("Unknown option", name));
    // Short flags cluster: `-fy` is `-f -y`, `-qtext` is `-q text`, and `-vq text` ends with the
    // flag that takes a value.
    for (let j = 1; j < arg.length; j += 1) {
      const short = `-${arg[j]}`;
      const cluster = byName.get(short);
      if (!cluster) throw new Error(labelled("Unknown option", short));
      if (!cluster.value) {
        cluster.apply(opts, "");
        continue;
      }
      const rest = arg.slice(j + 1);
      cluster.apply(opts, rest || readValue(argv, ++i, short));
      break;
    }
  }
  return opts;
}

/** The argument after a flag that takes a value; another flag there means the value is missing. */
function readValue(argv: readonly string[], index: number, name: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

/** What `askdb <name> --help` and `askdb help <name>` print. */
function formatHelp<O>(spec: CommandSpec<O>): string {
  const sections = new Map<string, OptionLine[]>([["Options", []]]);
  for (const flag of spec.flags) {
    const group = flag.group ?? "Options";
    if (!sections.has(group)) sections.set(group, []);
    sections.get(group)!.push({
      usage: flag.names.join(", ") + (flag.value ? ` ${flag.value}` : ""),
      help: typeof flag.help === "function" ? flag.help() : flag.help,
    });
  }
  sections.get("Options")!.push(...GENERAL_OPTION_LINES);
  return [
    `askdb ${spec.name} - ${spec.summary}`,
    "",
    "Usage:",
    ...spec.usage.map((line) => `  ${line}`),
    "",
    ...(spec.notes && spec.notes.length > 0 ? [...spec.notes, ""] : []),
    ...formatOptionSections(sections),
  ].join("\n");
}

/** `Heading:` then one aligned line per option, for each section with any. */
export function formatOptionSections(sections: ReadonlyMap<string, readonly OptionLine[]>): string[] {
  const all = [...sections.values()].flat();
  const width = Math.max(...all.map((line) => line.usage.length)) + 2;
  return [...sections].flatMap(([heading, lines]) =>
    lines.length === 0 ? [] : [`${heading}:`, ...lines.map((line) => `  ${line.usage.padEnd(width)}${line.help}`), ""],
  );
}
