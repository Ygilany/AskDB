#!/usr/bin/env node
/**
 * `askdb-introspect` binary skeleton. The full CLI surface (`--url`,
 * `--from-export`, `--diff`, `--print`, `templates`) lands in milestone 7
 * (see docs/specs/phase-6-introspection/plan.md §7).
 *
 * Until then this binary recognizes only `--version` / `-V` and `--help` /
 * `-h` so consumer install smokes (Phase 4 → Phase 6 §9) can sanity-check the
 * package without depending on the unimplemented surface.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // Built layout: dist/bin.js → ../package.json
  const pkgPath = resolve(here, "..", "package.json");
  const raw = readFileSync(pkgPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (
    parsed &&
    typeof parsed === "object" &&
    "version" in parsed &&
    typeof (parsed as { version: unknown }).version === "string"
  ) {
    return (parsed as { version: string }).version;
  }
  return "0.0.0";
}

function printHelp(): void {
  process.stdout.write(
    [
      "askdb-introspect — Schema introspection for AskDB (phase 6, in progress)",
      "",
      "Usage:",
      "  askdb-introspect --version",
      "  askdb-introspect --help",
      "",
      "Subcommands and flags arrive in milestone 7 of phase 6:",
      "  askdb-introspect --url <postgres-url> --out <dir>",
      "  askdb-introspect --from-export <bundle-dir> --out <dir>",
      "  askdb-introspect --diff <existing-dir> --url <postgres-url>",
      "  askdb-introspect --print --url <postgres-url>",
      "  askdb-introspect templates --engine postgres",
      "",
      "See docs/specs/phase-6-introspection/ for the spec pack.",
      "",
    ].join("\n"),
  );
}

function main(argv: readonly string[]): number {
  if (argv.includes("--version") || argv.includes("-V")) {
    process.stdout.write(`${readPackageVersion()}\n`);
    return 0;
  }
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }
  process.stderr.write(
    "askdb-introspect: command not implemented yet (phase 6, milestone 7).\n" +
      "Run with --help to see the planned surface.\n",
  );
  return 2;
}

const exitCode = main(process.argv.slice(2));
process.exit(exitCode);
