---
"@askdb/docs-site": patch
---

The docs site's diagram renderer moves from pele 1.10.0 to 1.13.0, still pinned exactly (ADR 0041). 1.13.0 was published 2026-10-31 and merged once it was 14 days old. It reports an error at the end of a diagram on the diagram's last line, so the build error's page line now points at the broken line, not the closing fence.
