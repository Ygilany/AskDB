// Turns each ```mermaid fence into an inline SVG at build time with pele (ADR 0041), so pages ship
// no diagram JavaScript. The SVG takes its colors from the `--pele-*` variables in
// src/styles/custom.css, so it follows the theme toggle without a second render. A diagram pele
// can't render fails the build, naming the page, the line and pele's error code.
import { PeleError, render } from "pele";

/**
 * The label fonts. pele sizes each node from the font's measurements, and at build time there is
 * no computed style to read them from, so the plugin passes the site's own stacks: `--sl-font` and
 * `--sl-font-mono` in src/styles/custom.css. A test keeps them equal.
 */
export const DIAGRAM_FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const DIAGRAM_FONT_MONO = '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, ui-monospace, monospace';

/** Thrown for a diagram pele can't render. `code` is pele's: `syntax`, `semantic`, `unsupported-diagram` or `limit`. */
export class DiagramRenderError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "DiagramRenderError";
    this.code = cause.code;
  }
}

/** Mermaid source to an SVG string. `idPrefix` keeps the SVG's ids unique on its page. */
export function renderDiagram(source, idPrefix) {
  return render(source, {
    fontFamily: DIAGRAM_FONT,
    fontFamilyMono: DIAGRAM_FONT_MONO,
    idPrefix,
    links: false,
    images: false,
  }).svg;
}

export function remarkMermaid() {
  return (tree, file) => {
    let count = 0;
    const walk = (parent) => {
      if (!parent.children) return;
      parent.children.forEach((node, index) => {
        if (node.type === "code" && node.lang === "mermaid") {
          parent.children[index] = { type: "html", value: renderFence(node, file, `mermaid-${count++}`) };
        } else {
          walk(node);
        }
      });
    };
    walk(tree);
  };
}

function renderFence(node, file, idPrefix) {
  try {
    return renderDiagram(node.value, idPrefix);
  } catch (error) {
    if (!(error instanceof PeleError)) throw error;
    // The diagram's first line is the line after the opening fence.
    const fenceLine = node.position?.start.line;
    const line = fenceLine && error.line > 0 ? fenceLine + sourceLine(node.value, error) : fenceLine;
    const where = `${file.path ?? "a page"}${line ? `:${line}` : ""}`;
    throw new DiagramRenderError(`${where}: mermaid diagram failed to render (PeleError ${error.code}): ${error.message}`, error);
  }
}

/**
 * The diagram line a `PeleError` points to, counted from the diagram's first line. pele numbers
 * lines after it drops front matter, comments, directives and some blank lines, so its `line`
 * can't be used as is. Its `snippet` quotes the line itself, so this finds that line, and takes
 * the match nearest the estimate if the text occurs more than once.
 */
function sourceLine(source, { line, snippet }) {
  const lines = source.split("\n");
  const estimate = estimateLine(lines, line);
  const quoted = snippet?.split("\n")[0] ?? "";
  if (!quoted.trim()) return estimate;
  const matches = lines.flatMap((text, index) => (text.trim() === quoted.trim() ? [index + 1] : []));
  if (matches.length === 0) return estimate;
  return matches.reduce((best, match) => (Math.abs(match - estimate) < Math.abs(best - estimate) ? match : best));
}

/**
 * pele's `line` counted back to the source, skipping front matter and `%%` lines: right for a
 * diagram without blank lines. With no quoted text (the end of the diagram), a line past the last
 * one is the closing fence.
 */
function estimateLine(lines, peleLine) {
  let start = 0;
  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((text, index) => index > 0 && text.trim() === "---");
    if (close > 0) start = close + 1;
  }
  let kept = 0;
  for (let index = start; index < lines.length; index++) {
    if (/^\s*%%/.test(lines[index])) continue;
    if (++kept === peleLine) return index + 1;
  }
  return lines.length + 1;
}
