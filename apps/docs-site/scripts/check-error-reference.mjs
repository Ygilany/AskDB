// Fails when an error class or code in @askdb/core's or @askdb/client's errors.ts is missing
// from its API reference page, so a new class or code can't ship undocumented (#287), and when
// the page's Errors tables list one that errors.ts no longer declares (#682).
//
// It reads each errors.ts with a small parser, not the TypeScript compiler, and fails closed:
// an export it can't classify stops the check instead of being skipped. A name counts as
// documented when it appears anywhere on the page as `` `name` `` or `"name"`.
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repoRoot = new URL("../../../", import.meta.url);
const docsRoot = new URL("../src/content/docs/reference/", import.meta.url);

/** Each errors.ts and the reference page that documents it. */
const ERROR_SOURCES = [
  { sourceUrl: new URL("packages/core/src/errors.ts", repoRoot), pageUrl: new URL("core-api.mdx", docsRoot) },
  { sourceUrl: new URL("packages/client/src/errors.ts", repoRoot), pageUrl: new URL("client-api.mdx", docsRoot) },
];

/**
 * `source` with its comments removed, read in source order so that a comment marker inside a
 * string, or a `/*` inside a `//` comment, is read as text. Strings are kept as they are.
 */
function stripComments(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      out += " ";
    } else if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) j += source[j] === "\\" ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j + 1;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

const STRING_LITERAL = /^(?:"[^"]*"|'[^']*')$/;

/**
 * The members of the type body that starts at `start` in `code`: the parts between `|`s outside
 * brackets and strings, up to the first `;` outside them. A leading `|` is allowed.
 */
function unionMembers(code, start) {
  const members = [];
  let depth = 0;
  let current = "";
  let i = start;
  for (; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < code.length && code[j] !== ch) j += code[j] === "\\" ? 2 : 1;
      current += code.slice(i, j + 1);
      i = j;
      continue;
    }
    if ("{([<".includes(ch)) depth++;
    if ("})]".includes(ch) || (ch === ">" && code[i - 1] !== "=")) depth--;
    if (depth === 0 && ch === ";") break;
    if (depth === 0 && ch === "|") {
      members.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  members.push(current.trim());
  return members.filter(Boolean);
}

/**
 * The exported error class names and code literals in `code` (an errors.ts without comments).
 * Every exported class counts as an error class. An exported type must be a union of string
 * literals (its members are codes) or an object type, or a union of object types (a shape,
 * skipped). Any other export throws, so the parser is extended before a new form goes unchecked.
 */
function documentedNames(code) {
  const names = [];
  for (const match of code.matchAll(/^export\s+(.*)$/gm)) {
    const rest = match[1];
    const cls = /^(?:abstract\s+)?class\s+(\w+)/.exec(rest);
    if (cls) {
      names.push(cls[1]);
      continue;
    }
    const type = /^type\s+(\w+)(?:<[^=]*>)?\s*=/.exec(rest);
    if (!type) throw new Error(`Can't classify the export \`export ${rest.trim()}\`; extend the parser.`);
    const members = unionMembers(code, match.index + match[0].length - rest.length + type[0].length);
    if (members.length > 0 && members.every((member) => STRING_LITERAL.test(member))) {
      names.push(...members.map((member) => member.slice(1, -1)));
    } else if (!members.every((member) => member.startsWith("{"))) {
      throw new Error(`Can't classify the type \`${type[1]}\`; extend the parser.`);
    }
  }
  if (names.length === 0) throw new Error("Found no exported error class or code; the parser needs updating.");
  return names;
}

/**
 * The error class names and codes in `sourceText` (an errors.ts) that `pageText` doesn't show
 * as `` `name` `` or `"name"`. Throws for an export it can't classify.
 */
export function missingFromPage(sourceText, pageText) {
  return documentedNames(stripComments(sourceText)).filter(
    (name) => !pageText.includes(`\`${name}\``) && !pageText.includes(`"${name}"`),
  );
}

/**
 * The names in the first column of the tables in `pageText`'s `## Errors` section (each row
 * starting `` | `name` | ``) that `sourceText` (an errors.ts) doesn't declare: rows left
 * behind when a class or code is removed. Throws when the page has no `## Errors` section.
 */
export function staleOnPage(sourceText, pageText) {
  const section = /^## Errors\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(pageText);
  if (!section) throw new Error("The page has no `## Errors` section.");
  const declared = new Set(documentedNames(stripComments(sourceText)));
  const rows = [...section[1].matchAll(/^\| `(\w+)` \|/gm)].map((match) => match[1]);
  return rows.filter((name) => !declared.has(name));
}

async function main() {
  let failed = false;
  for (const { sourceUrl, pageUrl } of ERROR_SOURCES) {
    const [sourceText, pageText] = [await readFile(sourceUrl, "utf8"), await readFile(pageUrl, "utf8")];
    const page = fileURLToPath(pageUrl);
    const source = fileURLToPath(sourceUrl);
    const missing = missingFromPage(sourceText, pageText);
    if (missing.length > 0) {
      failed = true;
      console.error(`${page} doesn't document these from ${source}; add each one to its Errors section:`);
      for (const name of missing) console.error(`- ${name}`);
    }
    const stale = staleOnPage(sourceText, pageText);
    if (stale.length > 0) {
      failed = true;
      console.error(`${page}'s Errors section lists these, which ${source} doesn't declare; remove each row:`);
      for (const name of stale) console.error(`- ${name}`);
    }
  }
  if (failed) process.exitCode = 1;
}

// Compare real paths, so a run through a symbolic link (macOS's /tmp) still runs the check.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  await main();
}
