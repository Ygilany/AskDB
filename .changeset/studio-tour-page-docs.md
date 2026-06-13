---
---

docs(site): add Studio visual tour page with real screenshots

- New `studio.mdx` page in the Start sidebar group with a screenshot-led tour of
  all seven Studio views: Overview, Tables & enrichment, Concepts, Playground, and
  Tenancy (five screenshots captured from the running app against the fixture schema
  with `ASKDB_MOCK_SQL=1`)
- Each section grounds capabilities in the Studio README and observed app behaviour
- Adds `sharp` dev dep so Astro's image optimisation pipeline can process the PNGs
- Cross-links from Quickstart (step 3) and "Author your schema" guide to `/studio/`
