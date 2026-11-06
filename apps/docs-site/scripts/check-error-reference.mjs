// Fails when an error class or code in @askdb/core's or @askdb/client's errors.ts is missing
// from its API reference page, so a new class or code can't ship undocumented (#287).
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repoRoot = new URL("../../../", import.meta.url);
const docsRoot = new URL("../src/content/docs/reference/", import.meta.url);

/** Each errors.ts and the reference page that documents it. */
const ERROR_SOURCES = [
  { source: new URL("packages/core/src/errors.ts", repoRoot), page: new URL("core-api.mdx", docsRoot) },
  { source: new URL("packages/client/src/errors.ts", repoRoot), page: new URL("client-api.mdx", docsRoot) },
];

/** `source` without comments. A `//` counts only at a line start or after whitespace, so `"a://b"` survives. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

/** Names of the exported error classes: every class that extends `Error` or another `…Error` class. */
function errorClassNames(source) {
  const names = [];
  for (const match of source.matchAll(/export class (\w+) extends (\w+)/g)) {
    if (match[2].endsWith("Error")) names.push(match[1]);
  }
  return names;
}

/** The string literals of every exported type that is a union of string literals only. */
function codeUnionLiterals(source) {
  const literals = [];
  for (const match of source.matchAll(/export type \w+\s*=([^;]*);/g)) {
    const members = match[1].split("|").map((member) => member.trim()).filter(Boolean);
    if (members.length > 0 && members.every((member) => /^"[^"]*"$/.test(member))) {
      literals.push(...members.map((member) => member.slice(1, -1)));
    }
  }
  return literals;
}

/**
 * The error class names and codes in `source` (an errors.ts) that `page` doesn't show as
 * `` `name` `` or `"name"`. Throws when `source` has no error class, so a parser that finds
 * nothing can't pass.
 */
export function missingFromPage(source, page) {
  const code = stripComments(source);
  const classes = errorClassNames(code);
  if (classes.length === 0) throw new Error("Found no exported error class; the parser needs updating.");
  const names = [...classes, ...codeUnionLiterals(code)];
  return names.filter((name) => !page.includes(`\`${name}\``) && !page.includes(`"${name}"`));
}

async function main() {
  let failed = false;
  for (const { source, page } of ERROR_SOURCES) {
    const missing = missingFromPage(await readFile(source, "utf8"), await readFile(page, "utf8"));
    if (missing.length > 0) {
      failed = true;
      console.error(`${fileURLToPath(page)} doesn't document these from ${fileURLToPath(source)}:`);
      for (const name of missing) console.error(`- ${name}`);
    }
  }
  if (failed) {
    console.error("Add each one to the page's Errors section.");
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
