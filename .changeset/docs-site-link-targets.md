---
"@askdb/docs-site": patch
---

The docs site test now fails on an internal link to a missing page or `#anchor` (#713). `scripts/check-link-targets.mjs` reads every `<a href>` in the built site, the sidebar and MDX components included, and follows a redirect before it checks the anchor. It runs in `test:links`, so the Pages deploy runs it too. The `ask() options` stub page is deleted, and `/reference/ask-options/` now redirects to the `@askdb/core` API reference. The sidebar groups the guides into Build, Run in production, Tenancy, Maintain and Integrations, and the reference pages into Surfaces, Packages and releases, and APIs. No page URL changes.
