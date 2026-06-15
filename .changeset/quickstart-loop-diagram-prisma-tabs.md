---
---

docs(quickstart): ask-first loop diagram, Prisma-as-tab, Studio→embed framing

- Reorder the quickstart loop SVG so `ask` (green) precedes `enrich` (red); trim `viewBox` from 920→765 to remove dead space; loop-back arrow now runs enrich→ask
- Convert the two H3 introspection variants ("From a live database" / "From a Prisma schema") into a single `<Tabs syncKey="engine">` block
- Expand the "In Studio (recommended)" section with a sentence connecting Studio iteration to the eventual embed step
