---
"@askdb/studio": patch
---

**@askdb/studio**: The Overview page's "Resync schema" status message now shows a loading/check/error icon (previously plain colored text via `InlineStatus`, unlike `StatusBanner`'s matching icon set) and clears itself 4s after success, matching the existing auto-clear behavior for table save and RAG build statuses.
