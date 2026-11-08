# ADR 0034 — Docs-site diagrams are D2, rendered to inline SVG at build time

## Status

Accepted (2026-11-06, the coordinating thread's answer to Stop 1 of #713, Q3). Implemented in PR #736.

Superseded 2026-11-07 by [ADR 0041](0041-docs-diagrams-are-mermaid-rendered-by-pele.md): docs-site diagrams are now Mermaid, rendered at build time by pele, and `astro-d2` is gone. The text below is kept as written.

## Context

The docs site (`apps/docs-site`, Astro Starlight) had five hand-drawn SVG diagrams and no way to write a diagram as source. A hand-drawn SVG drifts from the page around it with nothing to catch it, and redrawing one takes a vector editor.

CI builds the site in five job runs (`build`, `unit-node-matrix` on Node 22, 24 and 26, and `test`, because the docs-site `test` script runs `astro build`), `lint` runs `astro check` on it, and `pages.yml` builds it for the deploy. All of them install with pnpm and nothing else. A tool that needs a binary or a browser needs an install step in each of those runs.

Starlight switches its colors on `data-theme`, which the reader sets with the theme toggle. A diagram should follow that toggle, not the operating system's setting.

## Options considered

- **A. D2 through `astro-d2`, with D2's WebAssembly build (`experimental.useD2js`) and inline SVG (chosen).** npm packages only, with no install scripts. Inline SVG lets `custom.css` map D2's palette classes to Starlight's color variables, so a diagram follows the toggle in every engine tested.
- **B. `astro-d2` with the D2 binary.** Rejected: every CI job run and the deploy would need a binary install step, and every author a local install.
- **C. `rehype-mermaid` with Playwright.** Rejected: every job run would install Chromium. Its dark mode follows the operating system through `<picture media="(prefers-color-scheme)">`, not the toggle.
- **D. Authors pre-render with a CLI (`mmdc` or `d2`) and commit the SVG.** Rejected: the source and the SVG can drift with nothing catching it, and `mmdc` needs Puppeteer, whose install script `allowBuilds` blocks.
- **E. Client-side Mermaid.** Rejected: it ships several megabytes of JavaScript to readers for static pictures.
- **F. Graphviz through `@viz-js/viz`, or `beautiful-mermaid`.** Rejected: neither has an Astro integration, Graphviz's DOT looks dated, and every `beautiful-mermaid` SVG imports Google Fonts.

## Decision

- A docs-site diagram is D2 source, in `apps/docs-site/src/assets/diagrams/d2/` or in a `d2` fence, rendered at build time by `astro-d2` with `useD2js` and `inline: true`. Pages ship the SVG and no diagram JavaScript.
- D2's own dark theme is off. `custom.css` maps D2's theme-0 palette classes to Starlight's color variables, and authors use the palette, not hard-coded colors.
- `apps/docs-site/STYLE.md` ("Diagrams") holds the authoring rules.
- The hand-drawn SVGs stay until their pages change, and are then redrawn in D2.

## Consequences

- `useD2js` is marked experimental upstream, and `astro-d2` is 0.x. A minor `astro-d2` release can change it, so a bump is a deliberate change that rebuilds the site and checks a diagram in both themes.
- `astro-d2` ignores a fence's `width` and `title` with D2's WebAssembly build: it looks for the D2 CLI's `d2Version` attribute, which the WebAssembly build writes as `data-d2-version` ([astro-d2#69](https://github.com/HiDeoo/astro-d2/issues/69)). A page sizes a diagram with `--d2-width` on its `<figure>`, and the `<figcaption>` is the text alternative.
- D2's embedded `<style>` doesn't reach the page: MDX's static optimizer moves it into a `set:html` attribute and leaves the element empty ([astro#18652](https://github.com/withastro/astro/issues/18652)). Labels render in the site font, and `custom.css` stands in for the D2 rules a diagram needs. Markdown labels and sketch mode lose their styling.
- `@d2lang/d2` adds about 91 MB to the docs site's dev install. Nothing but the SVGs reaches readers.
- Astro 7.4.7 is the oldest release whose markdown pipeline builds with `astro-d2`, and the docs site pins `@emnapi/runtime` 1.x so that `astro check` still loads with it.
