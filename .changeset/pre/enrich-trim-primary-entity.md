---
"@askdb/enrich": patch
---

`buildFrontmatter` trims `primaryEntity` and leaves it out when it's only spaces. Studio now keeps the field as typed, so the trim happens here when the draft is written (#1052).
