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
    // pele counts lines in the source as written, comments and front matter included. From 1.13 it
    // puts an error at the end of the diagram on the line where the diagram stops, not on the closing fence.
    const line = fenceLine && error.line > 0 ? fenceLine + error.line : fenceLine;
    const where = `${file.path ?? "a page"}${line ? `:${line}` : ""}`;
    throw new DiagramRenderError(`${where}: mermaid diagram failed to render (PeleError ${error.code}): ${error.message}`, error);
  }
}
