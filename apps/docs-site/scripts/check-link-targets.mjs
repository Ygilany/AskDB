// Fails when a link in the built site points at a page that doesn't exist, or at an anchor that
// isn't on its page (#713). check-base-links.mjs checks only that a link carries the base path.
//
// It reads the HTML in dist/, so it sees every link a reader can click: Markdown links, links in
// MDX components, the sidebar, and pagination. External links (http:, mailto:, //host) are not
// checked. A link with a #fragment to a redirect page fails, because the redirect (a meta refresh)
// drops the fragment and the reader lands at the top of the new page.
import { realpathSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** `html` without comments, or the contents of script and style elements, which hold code. */
function markupOnly(html) {
  return html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
}

// A start tag. A quoted attribute value is read whole, so a `>` inside one doesn't end the tag, and
// markup inside one (a code sample in a copy button's `data-code`) is never read as a tag.
const START_TAG = /<([a-z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>/gi;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** Each start tag in `html`: its lower-case name and attributes, the first of a repeated one winning. */
function* startTags(html) {
  for (const [, name, rest] of markupOnly(html).matchAll(START_TAG)) {
    const attributes = new Map();
    for (const [, key, double, single, bare] of rest.matchAll(ATTRIBUTE)) {
      const lower = key.toLowerCase();
      if (!attributes.has(lower)) attributes.set(lower, decodeEntities(double ?? single ?? bare ?? ""));
    }
    yield { name: name.toLowerCase(), attributes };
  }
}

/** Every `id` in `html`, and every `name` on an `<a>`: the anchors a fragment can land on. */
function anchorsIn(html) {
  const anchors = new Set();
  for (const { name, attributes } of startTags(html)) {
    if (attributes.has("id")) anchors.add(attributes.get("id"));
    if (name === "a" && attributes.has("name")) anchors.add(attributes.get("name"));
  }
  return anchors;
}

/** The `href` of every `<a>` in `html`. */
function linksIn(html) {
  const links = [];
  for (const { name, attributes } of startTags(html)) {
    if (name === "a" && attributes.has("href")) links.push(attributes.get("href"));
  }
  return links;
}

/** The target of a `<meta http-equiv="refresh">` in `html` (an Astro redirect page), or undefined. */
function redirectTargetIn(html) {
  for (const { name, attributes } of startTags(html)) {
    if (name !== "meta" || attributes.get("http-equiv")?.toLowerCase() !== "refresh") continue;
    const url = /url\s*=\s*(.+)$/i.exec(attributes.get("content") ?? "");
    if (url) return url[1].trim().replace(/^['"]|['"]$/g, "");
  }
  return undefined;
}

/**
 * The broken links in a built site. `files` maps each file's path in the build output, without the
 * base (`/quickstart/index.html`, `/AGENTS.md`), to its HTML, or to null for a file that isn't
 * HTML. `base` is the base path the site is served under. Returns one `{ page, href, reason }` per
 * broken link, `page` being the file it's on.
 */
export function brokenLinks(files, base = "/") {
  const basePath = base === "/" ? "" : base.replace(/\/$/, "");
  const anchorCache = new Map();
  const anchorsOf = (path) => {
    if (!anchorCache.has(path)) anchorCache.set(path, anchorsIn(files.get(path)));
    return anchorCache.get(path);
  };

  /** The site path of the file a URL path serves, or undefined: `/a/` → `/a/index.html`. */
  const fileFor = (pathname) => {
    if (basePath && pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return undefined;
    const path = pathname.slice(basePath.length) || "/";
    const candidates = path.endsWith("/") ? [`${path}index.html`] : [path, `${path}/index.html`, `${path}.html`];
    return candidates.find((candidate) => files.has(candidate));
  };

  const failures = [];
  for (const [page, html] of files) {
    if (html === null) continue;
    // The URL the page is served at, so `#x` and `../` resolve as a browser resolves them.
    const pageUrl = new URL(`${basePath}${page.replace(/index\.html$/, "")}`, "https://site.invalid");
    for (const href of linksIn(html)) {
      if (href === "" || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) continue;
      const url = new URL(href, pageUrl);
      const target = fileFor(decodeURIComponent(url.pathname));
      if (target === undefined) {
        failures.push({ page, href, reason: "no page at this path" });
        continue;
      }
      if (url.hash.length <= 1 || files.get(target) === null) continue;
      const redirect = redirectTargetIn(files.get(target));
      if (redirect !== undefined) {
        failures.push({ page, href, reason: `redirects to ${redirect}, which drops the #fragment; link there directly` });
        continue;
      }
      const fragment = decodeURIComponent(url.hash.slice(1));
      if (!anchorsOf(target).has(fragment)) {
        failures.push({ page, href, reason: `no id="${fragment}" on ${target}` });
      }
    }
  }
  return failures;
}

async function readSite(distDir) {
  const files = new Map();
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        const sitePath = `/${relative(distDir, path).split(sep).join("/")}`;
        files.set(sitePath, entry.name.endsWith(".html") ? await readFile(path, "utf8") : null);
      }
    }
  };
  await walk(distDir);
  return files;
}

// Compare real paths, so a run through a symbolic link (macOS's /tmp) still runs the check.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const distDir = fileURLToPath(new URL("../dist", import.meta.url));
  const failures = brokenLinks(await readSite(distDir), process.argv[2] ?? "/");
  if (failures.length > 0) {
    console.error(`Found ${failures.length} link(s) to a missing page or anchor:`);
    for (const { page, href, reason } of failures) console.error(`- ${page}: ${href} (${reason})`);
    process.exit(1);
  }
  console.log("Every internal link reaches an existing page and anchor.");
}
