---
"@askdb/studio": minor
---

Revamp Studio with adaptive navigation, UX polish, and a Query Playground.

**Adaptive sidebar navigation**: the left sidebar now adapts to the active view — Tables and Concepts show the searchable table list, Tenancy shows a six-section nav (Roots, Hierarchy, Scoped Tables, Polymorphic Tables, Global Tables, Policy Warnings) with count badges and smooth scroll-to-section on click.

**Query Playground**: a new fourth main view with a two-column layout — question input and tenant controls on the left, generated SQL and results on the right. Every successful generation is automatically saved to `playground-history.json` in the schema artifact directory. The history sidebar lets you restore, compare, and re-run past queries. When `DATABASE_URL` is configured, an Execute button runs the generated SQL in a read-only transaction and renders a results table (truncated at 500 rows).

**UX polish**: success and neutral status messages auto-dismiss after 4 s (errors persist until resolved). The sidebar collapses on small screens with a hamburger toggle in the main content area; on large screens it is always pinned.

**New server endpoints**: `GET /api/history`, `POST /api/history`, `DELETE /api/history/:id` (file-backed persistence), and `POST /api/execute` (read-only Postgres execution via lazy `pg` load).
