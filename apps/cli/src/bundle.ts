import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { errorMessage } from "./cli-error.js";
import { EXPERIMENTAL_ADR_URL, runCommand, type CommandSpec } from "./command.js";

const USAGE = "askdb bundle <schema-dir> --out <bundle.json>";

type BundleOptions = { schemaDir?: string; out?: string };

/** `askdb bundle`: one schema directory as one JSON file. It never reads askdb.config. */
export function bundleCommand(): CommandSpec<BundleOptions> {
  return {
    name: "bundle",
    summary: "Bundle a schema directory into a single JSON file (experimental)",
    usage: [USAGE],
    notes: [`Experimental: a minor release of askdb may change this command (${EXPERIMENTAL_ADR_URL}).`],
    flags: [
      {
        names: ["--out"],
        value: "<bundle.json>",
        help: "Write the bundle here (required).",
        apply: (opts, value) => (opts.out = value),
      },
    ],
    positional(opts, value, index) {
      if (index > 0) {
        throw new Error("Unexpected argument: askdb bundle takes one <schema-dir>. Pass the output path with --out.");
      }
      opts.schemaDir = value;
    },
    initial: () => ({}),
    check(opts) {
      if (!opts.schemaDir || !opts.out) throw new Error(`Usage: ${USAGE}`);
    },
    needsConfig: () => false,
    async run(opts) {
      const { bundleSchemaDirectory } = await import("@askdb/enrich");
      const outPath = resolve(opts.out!);
      try {
        // Throws the loader's error for a directory `loadSchema()` refuses, before anything is
        // written, so a bundle this command writes always loads (#796).
        const bundle = bundleSchemaDirectory(resolve(opts.schemaDir!));
        writeFileSync(outPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
      } catch (error) {
        process.stderr.write(`askdb bundle: ${errorMessage(error)}\n`);
        return 1;
      }
      process.stdout.write(`Wrote ${outPath}\n`);
      return 0;
    },
  };
}

export function runBundleCli(argv: readonly string[]): Promise<number> {
  return runCommand(bundleCommand(), argv);
}
