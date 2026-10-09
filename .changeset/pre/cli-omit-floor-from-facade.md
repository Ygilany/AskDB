---
"askdb": patch
---

`askdb ask` leaves config `modes.omitSensitiveFromPrompt` to the `@askdb/client` facade, which now treats it as a floor, instead of OR-ing it with `--omit-sensitive-from-prompt` itself. No behavior change.
