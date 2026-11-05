// Finds README links that are dead once the README ships in a package tarball.
// Used by check-tarballs.mjs; self-test: readme-links.test.mjs (run by run.sh).
import path from "node:path";

// Code is not prose: `handlers[name](input)` or `[tenantRoot]: expand(…)` in a sample is not a
// link. Fenced blocks (``` or ~~~, closed by the same fence or the end of the file) and inline
// code spans (within one paragraph) are blanked before links are read. Indented code blocks
// are not: they look like list continuations, which can hold real links.
const FENCED_CODE = /^ {0,3}(`{3,}|~{3,}).*$[\s\S]*?(?:^ {0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gm;
const INLINE_CODE = /(`+)(?!`)(?:(?!\1)[^\n]|\n(?![ \t]*\n))*?\1(?!`)/g;

// Where a README names a file: Markdown inline links and images (`[text](target "title")`),
// reference definitions (`[id]: target`, also inside a blockquote; not `[^1]:` footnotes),
// and HTML `href`/`src` attributes.
const SINGLE_TARGETS = [
  /\]\(\s*<?([^)\s>]+)>?/g,
  /^ {0,3}(?:>[ \t]?)*[ \t]{0,3}\[(?!\^)[^\]]+\]:[ \t]*<?([^\s>]+)>?/gm,
  /\b(?:href|src)\s*=\s*["']([^"']*)["']/gi,
];
// An HTML `srcset` holds comma-separated candidates: a URL, then an optional size.
const SRCSET = /\bsrcset\s*=\s*["']([^"']*)["']/gi;
// A URL with a scheme (`https:`, `mailto:`), a protocol-relative URL, or an in-page anchor.
const NON_FILE_TARGET = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

function linkTargets(readme) {
  const prose = readme.replace(FENCED_CODE, " ").replace(INLINE_CODE, " ");
  const targets = [];
  for (const pattern of SINGLE_TARGETS) {
    for (const [, target] of prose.matchAll(pattern)) targets.push(target);
  }
  for (const [, srcset] of prose.matchAll(SRCSET)) {
    for (const candidate of srcset.split(",")) {
      const url = candidate.trim().split(/\s+/)[0];
      if (url) targets.push(url);
    }
  }
  return targets;
}

/** The tarball path a relative target names: no `./`, `?query`, `#anchor` or trailing `/`. */
function packagePath(target) {
  const file = target.split(/[?#]/)[0].replace(/^\.\//, "");
  return path.posix.normalize(file || ".").replace(/\/+$/, "");
}

/**
 * Relative README link targets that don't resolve to a file in the tarball. Anything that
 * reads the README from the package (an installed copy in node_modules, a CDN's file view)
 * resolves them against the package root, so a `../` link into the monorepo is dead there.
 * Link to the repository with an absolute GitHub URL instead.
 *
 * @param {string} readme the README's Markdown
 * @param {Set<string>} entries the tarball's file paths, relative to the package root
 * @returns {string[]} each dead target, as written
 */
export function deadReadmeLinks(readme, entries) {
  return linkTargets(readme).filter((target) => {
    if (NON_FILE_TARGET.test(target)) return false;
    const rel = packagePath(target);
    const ships = rel === "." || entries.has(rel) || [...entries].some((entry) => entry.startsWith(`${rel}/`));
    return !ships;
  });
}
