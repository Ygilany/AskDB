import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DIAGRAM_FONT, DIAGRAM_FONT_MONO, DiagramRenderError, remarkMermaid } from "./remark-mermaid.mjs";

/** A page's tree with `code` nodes in it, the way remark parses fences, and the file it came from. */
function page(...codes) {
  const tree = { type: "root", children: codes.map(([lang, value, line]) => ({ type: "code", lang, value, position: { start: { line } } })) };
  return { tree, file: { path: "src/content/docs/page.mdx" } };
}

test("each mermaid fence becomes an inline pele SVG, with ids unique on its page, and other fences stay code", () => {
  const diagram = "flowchart TB\n  accTitle: Steps\n  a --> b";
  const { tree, file } = page(["mermaid", diagram, 3], ["ts", "const a = 1;", 9], ["mermaid", diagram, 12]);
  remarkMermaid()(tree, file);
  const [first, code, second] = tree.children;
  assert.equal(first.type, "html");
  assert.match(first.value, /^<svg [^>]*class="pele pele-flowchart"/);
  assert.match(first.value, /id="mermaid-0-title"/);
  assert.deepEqual(code, { type: "code", lang: "ts", value: "const a = 1;", position: { start: { line: 9 } } });
  assert.match(second.value, /id="mermaid-1-title"/);
});

test("a diagram pele can't parse fails the build with pele's code and the line in the page", () => {
  // The fence opens on line 20, so the diagram's line 3 is the page's line 23.
  const { tree, file } = page(["mermaid", "flowchart TB\n  a --> b\n  c((x] --> d\n  e --> f", 20]);
  assert.throws(
    () => remarkMermaid()(tree, file),
    (error) =>
      error instanceof DiagramRenderError &&
      error.code === "syntax" &&
      error.message.startsWith("src/content/docs/page.mdx:23: mermaid diagram failed to render (PeleError syntax)"),
  );
});

test("a fence inside a <figure>, as every page has it, becomes an SVG too", () => {
  const fence = { type: "code", lang: "mermaid", value: "flowchart TB\n  a --> b", position: { start: { line: 3 } } };
  const figure = { type: "mdxJsxFlowElement", name: "figure", attributes: [], children: [fence] };
  const tree = { type: "root", children: [figure] };
  remarkMermaid()(tree, { path: "src/content/docs/page.mdx" });
  assert.equal(figure.children[0].type, "html");
  assert.match(figure.children[0].value, /^<svg [^>]*class="pele pele-flowchart"/);
});

test("the line in the page is the broken line, with comments, a directive, front matter or blank lines before it", () => {
  const broken = "c((x] --> d";
  const sources = [
    "flowchart TB\n  %% one\n  %% two\n  a --> b\n  " + broken,
    '%%{init: {"flowchart": {"curve": "basis"}}}%%\nflowchart TB\n  a --> b\n  ' + broken,
    "---\ntitle: T\n---\nflowchart TB\n  %% note\n  a --> b\n  " + broken,
    // A blank line before a comment, and a blank line at the start.
    "flowchart TB\n  a --> b\n\n  %% the query side\n  " + broken,
    "\nflowchart TB\n  a --> b\n  " + broken,
    // A directive in the middle.
    'flowchart TB\n  a --> b\n  %%{init: {"flowchart": {"curve": "basis"}}}%%\n  ' + broken,
  ];
  for (const source of sources) {
    const brokenLine = source.split("\n").findIndex((text) => text.includes(broken)) + 1;
    const { tree, file } = page(["mermaid", source, 40]);
    assert.throws(
      () => remarkMermaid()(tree, file),
      (error) => error.message.startsWith(`src/content/docs/page.mdx:${40 + brokenLine}: `),
      source,
    );
  }
});

test("an error at the end of the diagram points at the closing fence", () => {
  // The fence opens on line 40; the diagram is lines 41 and 42, so the closing fence is line 43.
  const { tree, file } = page(["mermaid", "flowchart TB\n  a -->", 40]);
  assert.throws(() => remarkMermaid()(tree, file), (error) => error.message.startsWith("src/content/docs/page.mdx:43: "));
});

test("a fence that isn't a diagram type pele knows fails with unsupported-diagram", () => {
  const { tree, file } = page(["mermaid", "not a diagram", 5]);
  assert.throws(() => remarkMermaid()(tree, file), (error) => error instanceof DiagramRenderError && error.code === "unsupported-diagram");
});

test("the plugin measures labels in the site's fonts: --sl-font and --sl-font-mono in custom.css", () => {
  const css = readFileSync(new URL("../src/styles/custom.css", import.meta.url), "utf8");
  const token = (name) => new RegExp(`${name}:\\s*([^;]+);`).exec(css)[1].replace(/\s+/g, " ").trim();
  assert.equal(DIAGRAM_FONT, token("--sl-font"));
  assert.equal(DIAGRAM_FONT_MONO, token("--sl-font-mono"));
});
