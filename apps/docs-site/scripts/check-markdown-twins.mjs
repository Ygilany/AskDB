// Fails when a built docs page has no Markdown twin, or when a twin isn't clean Markdown.
//
// Every page is also served as Markdown, at its URL with the trailing slash replaced by `.md`
// (src/pages/[...slug].md.ts). Agents are told so on every page and in /llms.txt, and the page
// header's "Copy as Markdown" fetches it, so a page without its twin is a broken promise.
//
// It reads dist/. A redirect page and the 404 page have no twin, but the 404 page needs /404.md.
import { realpathSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** The path of a page's twin in the build output: `/guides/x/index.html` → `/guides/x.md`, `/index.html` → `/index.md`. */
export function twinFileFor(pageFile) {
  const path = pageFile.replace(/\/index\.html$/, "");
  return path === "" ? "/index.md" : `${path}.md`;
}

const isRedirect = (html) => /<meta\s[^>]*http-equiv=["']?refresh/i.test(html);

/**
 * What's wrong with the twins of a built site. `files` maps each file's path in the build output
 * (`/quickstart/index.html`, `/quickstart.md`) to its text. `base` is the base path the site is
 * served under. Returns one `{ page, problem }` per fault.
 */
export function twinProblems(files, base = "/") {
  const basePath = base === "/" ? "" : base.replace(/\/$/, "");
  const problems = [];
  for (const [page, html] of files) {
    if (!page.endsWith("/index.html") || isRedirect(html)) continue;
    const twin = twinFileFor(page);
    const markdown = files.get(twin);
    if (markdown === undefined) {
      problems.push({ page, problem: `no Markdown twin at ${twin}` });
      continue;
    }
    // The page's <head> names the twin, so an agent that fetched the HTML can find it.
    const alternate = /<link\s[^>]*type=["']text\/markdown["'][^>]*>/i.exec(html)?.[0] ?? "";
    const href = /href=["']([^"']+)["']/i.exec(alternate)?.[1];
    if (!href) problems.push({ page, problem: 'no <link rel="alternate" type="text/markdown"> in its head' });
    else if (new URL(href, "https://site.invalid").pathname !== `${basePath}${twin}`) {
      problems.push({ page, problem: `its Markdown alternate is ${href}, not ${basePath}${twin}` });
    }
    if (!markdown.startsWith("# ")) problems.push({ page: twin, problem: "doesn't start with the page title as a heading" });
    if (/<svg[\s>]/i.test(markdown)) problems.push({ page: twin, problem: "holds an SVG; a diagram should be its text alternative or its Mermaid source, with its caption" });
    const relativeLink = /\]\((\/[^)\s]*)\)/.exec(markdown.replace(/```[\s\S]*?```/g, ""));
    if (relativeLink) problems.push({ page: twin, problem: `links to ${relativeLink[1]} without the site's origin` });
  }
  if (files.has("/404.html")) {
    if (!files.get("/404.md")?.includes("/llms.txt)")) problems.push({ page: "/404.md", problem: "missing, or doesn't link /llms.txt" });
  }
  return problems;
}

async function readSite(distDir) {
  const files = new Map();
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && /\.(html|md)$/.test(entry.name)) {
        files.set(`/${relative(distDir, path).split(sep).join("/")}`, await readFile(path, "utf8"));
      }
    }
  };
  await walk(distDir);
  return files;
}

// Compare real paths, so a run through a symbolic link (macOS's /tmp) still runs the check.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const files = await readSite(fileURLToPath(new URL("../dist", import.meta.url)));
  const problems = twinProblems(files, process.argv[2] ?? "/");
  if (problems.length > 0) {
    console.error(`Found ${problems.length} problem(s) with the pages' Markdown twins:`);
    for (const { page, problem } of problems) console.error(`- ${page}: ${problem}`);
    process.exit(1);
  }
  const twins = [...files.keys()].filter((path) => path.endsWith("/index.html") && files.has(twinFileFor(path))).length;
  console.log(`Every docs page has a clean Markdown twin (${twins} pages).`);
}
