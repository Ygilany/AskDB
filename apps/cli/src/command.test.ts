import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAskCli } from "./ask.js";
import { runBundleCli } from "./bundle.js";
import { runCommand, type CommandSpec } from "./command.js";
import { runCli } from "./dispatch.js";
import { runInitCli } from "./init.js";
import { runIntrospectCli } from "./introspect.js";
import { runRagCli } from "./rag.js";

let stdout = "";
let stderr = "";

beforeEach(() => {
  stdout = "";
  stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const SECRET_URL = "postgres://u:secret@h/db";

type Toy = { name?: string; on?: boolean; tags: string[] };

/** A command with one of each kind of flag; `run` records the options it was given. */
function toyCommand(overrides: Partial<CommandSpec<Toy>> = {}): CommandSpec<Toy> & { ran: Toy[] } {
  const ran: Toy[] = [];
  return {
    name: "toy",
    summary: "A command for these tests",
    usage: ["askdb toy"],
    flags: [
      { names: ["-n", "--name"], value: "<name>", help: "A value.", apply: (opts, value) => (opts.name = value) },
      { names: ["-o", "--on"], help: "A switch.", apply: (opts) => (opts.on = true) },
      { names: ["--tag"], value: "<tag>", help: "Repeatable.", apply: (opts, value) => opts.tags.push(value) },
    ],
    initial: () => ({ tags: [] }),
    needsConfig: () => false,
    run: async (opts) => {
      ran.push(opts);
      return 0;
    },
    ran,
    ...overrides,
  };
}

describe("runCommand parses every command's flags the same way", () => {
  it.each<[string, string[], Partial<Toy>]>([
    ["--flag value", ["--name", "a"], { name: "a" }],
    ["--flag=value", ["--name=a"], { name: "a" }],
    ["a value holding =", ["--name=a=b"], { name: "a=b" }],
    ["the short spelling", ["-n", "a"], { name: "a" }],
    ["a switch", ["--on"], { on: true }],
    ["a repeated flag, accumulating when it collects", ["--tag", "a", "--tag=b"], { tags: ["a", "b"] }],
    ["a repeated flag, last one winning otherwise", ["--name", "a", "--name", "b"], { name: "b" }],
    ["a short flag with its value attached", ["-na"], { name: "a" }],
    ["short flags together, the last taking the next argument", ["-on", "a"], { on: true, name: "a" }],
    ["short flags together, the last with its value attached", ["-ona"], { on: true, name: "a" }],
  ])("takes %s", async (_case, argv, expected) => {
    const toy = toyCommand();
    expect(await runCommand(toy, argv)).toBe(0);
    expect(stderr).toBe("");
    expect(toy.ran).toEqual([{ tags: [], ...expected }]);
  });

  it.each<[string, string[], string]>([
    ["a value on a switch", ["--on=yes"], "--on takes no value."],
    ["a missing value", ["--name"], "--name requires a value."],
    ["an empty value", ["--name="], "--name requires a value."],
    ["a flag where the value should be", ["--name", "--on"], "--name requires a value."],
    ["an unknown option", ["--nope"], "Unknown option: --nope"],
    ["an unknown short flag among others", ["-ox"], "Unknown option: -x"],
    ["an unknown --flag=value, without its value", [`--nope=${SECRET_URL}`], "Unknown option: --nope"],
    ["an unknown option that isn't showable", [`--${SECRET_URL}`], "Unknown option"],
    [
      "a stray positional, without repeating it",
      [SECRET_URL],
      "Unexpected argument: askdb toy takes no positional arguments. Pass values with their flag.",
    ],
  ])("rejects %s with a usage error and exit 1", async (_case, argv, message) => {
    const toy = toyCommand();
    expect(await runCommand(toy, argv)).toBe(1);
    expect(stderr).toBe(`${message}\n`);
    expect(toy.ran).toEqual([]);
  });

  it("prints the help on stdout and exits 0, ahead of anything else on the line", async () => {
    const toy = toyCommand();
    expect(await runCommand(toy, ["--nope", "--help"])).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("askdb toy - A command for these tests\n");
    expect(stdout).toMatch(/^ {2}-n, --name <name> +A value\.$/m);
    expect(toy.ran).toEqual([]);
  });

  it("reports a usage error before the config gate, so it shows outside a project", async () => {
    const empty = mkdtempSync(join(tmpdir(), "askdb-command-"));
    const cwd = process.cwd();
    process.chdir(empty);
    try {
      const toy = toyCommand({ needsConfig: () => true });
      expect(await runCommand(toy, ["--nope"])).toBe(1);
      expect(stderr).toBe("Unknown option: --nope\n");
      // Past parsing, the missing config propagates to the top-level handler.
      await expect(runCommand(toy, [])).rejects.toThrow("No askdb.config.*");
      expect(toy.ran).toEqual([]);
    } finally {
      process.chdir(cwd);
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

// Each command's own entry. A usage error stops before the config gate, so none of these reads askdb.config.
const COMMANDS: readonly [string, (argv: readonly string[]) => Promise<number>, readonly string[]][] = [
  ["init", runInitCli, []],
  ["introspect", runIntrospectCli, ["templates"]],
  ["rag", runRagCli, ["index", "./schema"]],
  ["ask", runAskCli, ["-q", "x"]],
  ["bundle", runBundleCli, ["./schema"]],
];

describe.each(COMMANDS)("askdb %s never repeats a value that can hold a secret", (_name, run, prefix) => {
  it.each<[string, string[]]>([
    ["an unknown --flag=value", [`--nope=${SECRET_URL}`]],
    ["a stray positional", [SECRET_URL, SECRET_URL]],
  ])("%s", async (_case, args) => {
    expect(await run([...prefix, ...args])).toBe(1);
    expect(stderr).not.toBe("");
    expect(stderr).not.toContain("secret");
  });
});

describe("askdb dispatch", () => {
  const NAMES = ["init", "introspect", "studio", "enrich", "bundle", "ask", "rag"];

  it("lists every command in askdb --help", async () => {
    expect(await runCli(["--help"])).toBe(0);
    for (const name of NAMES) expect(stdout).toMatch(new RegExp(`^ {2}${name} +\\S`, "m"));
  });

  it.each(NAMES)("`askdb help %s` prints exactly what `askdb %s --help` prints", async (name) => {
    expect(await runCli(["help", name])).toBe(0);
    const viaHelp = stdout;
    stdout = "";
    expect(await runCli([name, "--help"])).toBe(0);
    expect(viaHelp).not.toBe("");
    expect(stdout).toBe(viaHelp);
  });

  it("prints the help to stderr and exits 1 with no command", async () => {
    expect(await runCli([])).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("askdb help <command>");
  });

  it("rejects an unknown command without repeating a value it can't show", async () => {
    expect(await runCli([SECRET_URL])).toBe(1);
    expect(stderr).toBe("Unknown command. Run `askdb --help` for the commands.\n");
  });
});
