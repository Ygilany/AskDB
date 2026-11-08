# ADR 0041 — Docs-site diagrams are Mermaid, rendered to inline SVG at build time by pele

## Status

Accepted (2026-11-07, the maintainer's Round 16, Q41 → A). Supersedes [ADR 0034](0034-docs-diagrams-are-d2-rendered-at-build-time.md). Amended 2026-11-07: the pin moves to pele 1.10.0 (see Decision).

## Context

ADR 0034 made docs-site diagrams D2 source, rendered at build time by `astro-d2` with D2's WebAssembly build. That kept CI and the Pages deploy free of a binary or a browser, and kept diagram JavaScript off the pages, but the route cost more than it saved:

- **Sizing by hand.** `astro-d2` ignores a fence's `width` with the WebAssembly build ([astro-d2#69](https://github.com/HiDeoo/astro-d2/issues/69)), so each page set `--d2-width` on its `<figure>` to a number copied from the built SVG.
- **A stand-in stylesheet.** D2's embedded `<style>` never reached the page ([astro#18652](https://github.com/withastro/astro/issues/18652)), so `custom.css` mapped 36 of D2's palette classes to Starlight's colors and stood in for the rest of D2's rules.
- **An experimental build.** `useD2js` is experimental upstream, `astro-d2` is 0.x, and `@d2lang/d2` added about 91 MB to the docs site's dev install.
- **A less familiar syntax.** D2 is less widely known than Mermaid, which GitHub renders in issues, pull requests and Markdown files.

[pele](https://pele.run) (Obsidian, MIT) renders Mermaid 12.1's syntax to SVG with its own layout. Its `render()` is synchronous, runs in Node with no dependencies, writes no `<style>` element, and takes its colors from CSS variables on the SVG.

## Options considered

- **A. Mermaid, rendered at build time by pele through a remark plugin (chosen).** One npm package with no dependencies and no install script. The SVG carries its natural width and themes through `--pele-*` variables, so pages need no width and `custom.css` maps ten variables, not a palette.
- **B. Keep D2 (ADR 0034).** Rejected: the costs above.
- **C. `rehype-mermaid` or `mmdc`, which run Mermaid in a browser.** Rejected for ADR 0034's reasons: every CI job run would install Chromium, or Puppeteer's install script, which `allowBuilds` blocks.
- **D. Mermaid or pele's `mount()` in the browser.** Rejected: both ship JavaScript to readers for static pictures. pele's browser bundle is about 700 KB, smaller than Mermaid's, but still a script for a picture that doesn't change.
- **E. `beautiful-mermaid`.** Rejected, as in ADR 0034: every SVG imports Google Fonts.

## Decision

- A docs-site diagram is Mermaid, in a ```` ```mermaid ```` fence in its page. `apps/docs-site/plugins/remark-mermaid.mjs` renders it at build time with pele's `render()`, as inline SVG. Pages ship no diagram JavaScript.
- There is no computed style at build time, so the plugin passes the site's font stacks (`--sl-font` and `--sl-font-mono` in `custom.css`) as `fontFamily` and `fontFamilyMono`. A test keeps the two equal.
- A diagram pele can't render fails the build, with the page, the line and `PeleError`'s code (`syntax`, `semantic`, `unsupported-diagram` or `limit`). Nothing ships broken.
- `custom.css` maps pele's `--pele-*` variables to Starlight's color tokens, which switch on the theme toggle (`:root[data-theme="dark"]`), so a diagram follows the toggle without a second render. Authors don't color a diagram in its source.
- pele is pinned to an exact version, at least two weeks old when chosen. The first pin was 1.9.0 (published 2026-10-22). Since 2026-11-07 it is 1.10.0 (published 2026-10-24), whose `PeleError.line` counts lines in the source as written, comments, directives and front matter included ([obsidianmd/pele#61](https://github.com/obsidianmd/pele/issues/61)). So the plugin reports pele's own line, and no longer looks for the quoted line to correct it. A bump is a deliberate change: rebuild the site and check each diagram in both themes, at desktop width and at 390 px.
- `apps/docs-site/STYLE.md` ("Diagrams") holds the authoring rules. The hand-drawn SVGs stay until their pages change, and are then redrawn in Mermaid.

## Consequences

- pele lays diagrams out its own way, so Mermaid's live editor doesn't show what readers see. Authors check the built page.
- At build time pele sizes labels from its built-in width table (Helvetica and Arial metrics), while the page shows them in the site's font stack, so a wider font leaves a label less margin. In the six diagrams this ADR shipped with, every label fits in the system font (SF Pro) at 1280 px and 390 px. A diagram whose labels overflow needs a shorter label or a `<br/>`.
- The diagram's source sits in its page, so an edit to a diagram and to its caption land in one file. Maintainer notes go on `%%` comment lines, which don't reach the page.
- pele is 1.x and releases often (1.4 to 1.13 in October 2026). The exact pin means a new release changes nothing until someone bumps it.
- pele adds 3.5 MB to the docs site's dev install, and `astro-d2`, `@d2lang/d2` and `satteri` leave. Nothing but the SVGs reaches readers.
- The Astro 7.4.7 floor and the `@emnapi/runtime` 1.x pin from ADR 0034 stay. The floor no longer has a D2 reason but needs no lowering, and the pin keeps `astro check` loading with Astro's bundler, not with D2.
- The SVG has no accessible name of its own: the `<figcaption>` is the diagram's text alternative, as it was with D2.
