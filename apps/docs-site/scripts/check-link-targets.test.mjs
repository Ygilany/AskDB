import assert from "node:assert/strict";
import { test } from "node:test";
import { brokenLinks } from "./check-link-targets.mjs";

const page = (body) => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;
const redirect = (to) => `<!doctype html><meta http-equiv="refresh" content="0;url=${to}"><a href="${to}">${to}</a>`;

// A small built site: three pages (one with an encoded path), two redirects (one to a page that
// doesn't exist), and a file that isn't HTML.
const site = new Map([
  [
    "/index.html",
    page(`
      <h2 id="intro">Intro</h2>
      <a href="#intro">same page</a>
      <a href="/guide/">directory URL</a>
      <a href="/guide">no trailing slash</a>
      <a href="guide/#steps">relative, with an anchor</a>
      <a href="/guide/#caf%C3%A9">percent-encoded anchor</a>
      <a href="/caf%C3%A9/">percent-encoded path</a>
      <a href="/guide/?tab=npm#steps">query string</a>
      <a href="/AGENTS.md">a file that isn't HTML</a>
      <a href="/AGENTS.md#anything">an anchor on a file that isn't HTML</a>
      <a href="/old/">redirect</a>
      <a href="https://example.com/missing/">external</a>
      <a href="mailto:a@example.com">mail</a>
      <a href="//cdn.example.com/x.js">protocol-relative</a>
      <a data-note=" href=/in-a-value/" href="/guide/">an href inside another attribute's value</a>
      <button data-code="<a href=&quot;/in-a-copy-button/&quot;><h2 id=&quot;fake&quot;>">copy</button>
      <script>const html = '<a href="/in-a-script/">';</script>
      <!-- <a href="/in-a-comment/"> -->
      <pre><code>&lt;a href="/in-code/"&gt;</code></pre>

      <a href="/missing/">missing page</a>
      <a title="Guides > Build" href="/missing-after-gt/">missing page, after a > in a value</a>
      <a href="#nowhere">missing anchor, same page</a>
      <a href="#fake">an id that is only inside an attribute's value</a>
      <a href="/guide/#nowhere">missing anchor, other page</a>
      <a href="/old/#steps">an anchor through a redirect, which the redirect drops</a>
      <a href="/gone/">a redirect to a page that doesn't exist, reported on the redirect page</a>
    `),
  ],
  ["/guide/index.html", page(`<h2 id="steps">Steps</h2><h2 id="caf&#xe9;">Café</h2><a href="../">up</a>`)],
  ["/caf\u00e9/index.html", page("Café")],
  ["/old/index.html", redirect("/guide/")],
  ["/gone/index.html", redirect("/nowhere/")],
  ["/AGENTS.md", null],
]);

test("brokenLinks reports each link to a missing page or anchor, and nothing else", () => {
  assert.deepEqual(brokenLinks(site), [
    { page: "/index.html", href: "/missing/", reason: "no page at this path" },
    { page: "/index.html", href: "/missing-after-gt/", reason: "no page at this path" },
    { page: "/index.html", href: "#nowhere", reason: 'no id="nowhere" on /index.html' },
    { page: "/index.html", href: "#fake", reason: 'no id="fake" on /index.html' },
    { page: "/index.html", href: "/guide/#nowhere", reason: 'no id="nowhere" on /guide/index.html' },
    {
      page: "/index.html",
      href: "/old/#steps",
      reason: "redirects to /guide/, which drops the #fragment; link there directly",
    },
    { page: "/gone/index.html", href: "/nowhere/", reason: "no page at this path" },
  ]);
});

test("brokenLinks resolves links under a base path, and reports one without it", () => {
  const based = new Map([
    ["/index.html", page(`<a href="/AskDB/guide/#steps">with base</a><a href="/guide/">without base</a>`)],
    [
      "/guide/index.html",
      page(`<h2 id="steps">Steps</h2><a href="#steps">same page</a><a href="../">relative</a><a href="#nowhere">missing</a>`),
    ],
  ]);

  assert.deepEqual(brokenLinks(based, "/AskDB/"), [
    { page: "/index.html", href: "/guide/", reason: "no page at this path" },
    { page: "/guide/index.html", href: "#nowhere", reason: 'no id="nowhere" on /guide/index.html' },
  ]);
});
