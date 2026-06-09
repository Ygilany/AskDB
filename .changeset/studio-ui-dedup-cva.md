---
"@askdb/studio": patch
---

Refactor studio UI components: split monolithic `ui.tsx` into individual files under `ui/`, migrate `Badge` to `cva`-based variants, update all import sites to point directly to individual component files, and remove the unused `@radix-ui/react-slot` dependency.
