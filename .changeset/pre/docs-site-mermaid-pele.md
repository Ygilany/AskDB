---
"@askdb/docs-site": patch
---

The docs site draws its diagrams in Mermaid, rendered to inline SVG at build time by pele (#713, ADR 0041, which supersedes ADR 0034). A `mermaid` fence in a page becomes an SVG with no diagram JavaScript on the page, and a diagram pele can't render fails the build with pele's error code and the page line. The six D2 diagrams are redrawn in Mermaid, and `astro-d2` and its D2 files are gone. Diagrams follow the light and dark toggle through pele's CSS variables, and need no width set by hand. pele is pinned to an exact version. `STYLE.md` has the new diagram rules.
