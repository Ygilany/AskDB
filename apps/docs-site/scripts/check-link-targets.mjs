// Fails when a link in the built site points at a page that doesn't exist, or at an anchor that
// isn't on its page (#713). check-base-links.mjs checks only that a link carries the base path.
//
// It reads the HTML in dist/, so it sees every link a reader can click: Markdown links, links in
// MDX components, the sidebar, and pagination. External links (http:, mailto:, //host) are not
// checked. A redirect page counts as its target, so a link to a moved page's anchor is checked
// against the page it moved to.
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

/** `html` without the contents of its script and style elements, which hold code, not markup. */
function markupOnly(html) {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
}

/** The value of attribute `name` in `tag` (one start tag), with entities decoded, or undefined. */
function attribute(tag, name) {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  if (!match) return undefined;
  return decodeEntities(match[1] ?? match[2] ?? match[3]);
}

/** Every `id` in `html`, and every `name` on an `<a>`: the anchors a fragment can land on. */
function anchorsIn(html) {
  const anchors = new Set();
  for (const [tag] of markupOnly(html).matchAll(/<[a-z][^>]*>/gi)) {
    const id = attribute(tag, "id");
    if (id !== undefined) anchors.add(id);
    if (/^<a\s/i.test(tag)) {
      const name = attribute(tag, "name");
      if (name !== undefined) anchors.add(name);
    }
  }
  return anchors;
}

/** The `href` of every `<a>` in `html`. */
function linksIn(html) {
  const links = [];
  for (const [tag] of markupOnly(html).matchAll(/<a\s[^>]*>/gi)) {
    const href = attribute(tag, "href");
    if (href !== undefined) links.push(href);
  }
  return links;
}

/** The target of a `<meta http-equiv="refresh">` in `html` (an Astro redirect page), or undefined. */
function redirectTargetIn(html) {
  for (const [tag] of html.matchAll(/<meta\s[^>]*>/gi)) {
    if (attribute(tag, "http-equiv")?.toLowerCase() !== "refresh") continue;
    const url = /url\s*=\s*(.+)$/i.exec(attribute(tag, "content") ?? "");
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
      let target = fileFor(decodeURIComponent(url.pathname));
      if (target === undefined) {
        failures.push({ page, href, reason: "no page at this path" });
        continue;
      }
      if (url.hash.length <= 1) continue;
      // Follow one redirect, so the fragment is checked on the page the reader lands on.
      const redirect = files.get(target) === null ? undefined : redirectTargetIn(files.get(target));
      if (redirect !== undefined) {
        target = fileFor(decodeURIComponent(new URL(redirect, new URL(url.pathname, pageUrl)).pathname));
        if (target === undefined) {
          failures.push({ page, href, reason: `redirects to ${redirect}, which has no page` });
          continue;
        }
      }
      if (files.get(target) === null) continue;
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

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const distDir = fileURLToPath(new URL("../dist", import.meta.url));
  const failures = brokenLinks(await readSite(distDir), process.argv[2] ?? "/");
  if (failures.length > 0) {
    console.error(`Found ${failures.length} link(s) to a missing page or anchor:`);
    for (const { page, href, reason } of failures) console.error(`- ${page}: ${href} (${reason})`);
    process.exit(1);
  }
  console.log("Every internal link reaches an existing page and anchor.");
}
