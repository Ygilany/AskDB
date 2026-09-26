---
"@askdb/studio": patch
---

Remove the unused internal `redactUrl()` helper from Studio's introspection module. The introspection source label is redacted by the engine adapter's `resolveConnection()` through the connector registry; `redactUrl` had no remaining non-test callers.
