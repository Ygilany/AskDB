import assert from "node:assert/strict";
import { test } from "node:test";
import { twinFileFor, twinProblems } from "./check-markdown-twins.mjs";

const page = (twinHref, body = "") =>
  `<!doctype html><html><head><title>t</title>${twinHref ? `<link rel="alternate" type="text/markdown" href="${twinHref}">` : ""}</head><body>${body}</body></html>`;

test("a page's twin sits beside its directory, and the home page's is index.md", () => {
  assert.equal(twinFileFor("/guides/multi-tenancy/index.html"), "/guides/multi-tenancy.md");
  assert.equal(twinFileFor("/reference/core-api/index.html"), "/reference/core-api.md");
  assert.equal(twinFileFor("/index.html"), "/index.md");
});

test("a site whose pages each have a clean twin has no problems; redirects and the 404 page need none", () => {
  const site = new Map([
    ["/index.html", page("https://askdb.tools/index.md")],
    ["/index.md", "# AskDB\n"],
    ["/quickstart/index.html", page("https://askdb.tools/quickstart.md")],
    ["/quickstart.md", "# Quickstart\n\nSee [Install](https://askdb.tools/install/) and [this step](#run).\n\n```md\n[a](/in-a-code-block/)\n```\n"],
    ["/old/index.html", `<!doctype html><meta http-equiv="refresh" content="0;url=/quickstart/">`],
    ["/404.html", page("")],
    ["/404.md", "# Page not found\n\n- [llms.txt](https://askdb.tools/llms.txt)\n"],
  ]);
  assert.deepEqual(twinProblems(site), []);
});

test("a site with a 404 page needs a /404.md that links llms.txt", () => {
  assert.deepEqual(twinProblems(new Map([["/404.html", page("")]])), [{ page: "/404.md", problem: "missing, or doesn't link /llms.txt" }]);
});

test("twinProblems reports a missing twin, a missing or wrong alternate link, and a twin that isn't clean Markdown", () => {
  const site = new Map([
    ["/missing/index.html", page("https://askdb.tools/missing.md")],
    ["/no-link/index.html", page("")],
    ["/no-link.md", "# No link\n"],
    ["/wrong-link/index.html", page("https://askdb.tools/elsewhere.md")],
    ["/wrong-link.md", "# Wrong link\n"],
    ["/dirty/index.html", page("https://askdb.tools/dirty.md")],
    ["/dirty.md", `Title\n\n<svg viewBox="0 0 1 1"></svg>\n\n[Install](/install/)\n`],
  ]);
  assert.deepEqual(twinProblems(site), [
    { page: "/missing/index.html", problem: "no Markdown twin at /missing.md" },
    { page: "/no-link/index.html", problem: 'no <link rel="alternate" type="text/markdown"> in its head' },
    { page: "/wrong-link/index.html", problem: "its Markdown alternate is https://askdb.tools/elsewhere.md, not /wrong-link.md" },
    { page: "/dirty.md", problem: "doesn't start with the page title as a heading" },
    { page: "/dirty.md", problem: "holds an SVG; a diagram should be its text alternative or its Mermaid source, with its caption" },
    { page: "/dirty.md", problem: "links to /install/ without the site's origin" },
  ]);
});

test("under a base path, the alternate link carries the base", () => {
  const site = new Map([
    ["/quickstart/index.html", page("https://ygilany.github.io/AskDB/quickstart.md")],
    ["/quickstart.md", "# Quickstart\n"],
    ["/install/index.html", page("https://ygilany.github.io/install.md")],
    ["/install.md", "# Install\n"],
  ]);
  assert.deepEqual(twinProblems(site, "/AskDB/"), [
    { page: "/install/index.html", problem: "its Markdown alternate is https://ygilany.github.io/install.md, not /AskDB/install.md" },
  ]);
});
