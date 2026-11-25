---
"@askdb/studio": patch
---

Studio's Get-the-code panel now reads its per-provider SDK wiring from the setup wizard's `AI_PROVIDERS` list instead of keeping its own provider table, and the setup-providers drift test now also compares the SDK package against `@askdb/ai`'s `peerPackage` for every built-in provider.
