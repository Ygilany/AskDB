---
"@askdb/docs-site": patch
---

The docs site's diagram renderer moves from pele 1.9.0 to 1.10.0, still pinned exactly (#713, ADR 0041). 1.10.0 reports a diagram error's line as it appears in the source, with comments, directives and front matter counted (obsidianmd/pele#61), so the build error's page line now comes straight from pele, and the plugin no longer searches for the quoted line. All nine diagrams render byte for byte as they did under 1.9.0.
