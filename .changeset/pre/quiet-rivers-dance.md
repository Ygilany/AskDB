---
"@askdb/config": patch
---

Reject non-decimal `httpApi.listen.port` values: only a number, or a string of decimal digits, in 0–65535 is accepted, so `"0x50"`, `"1e3"`, `"+80"` and `"80.0"` now fail config loading instead of binding a different port. This is the same rule as the `askdb-http --port` flag (#1024), with one difference: the config still trims whitespace around a string, so `" 80 "` loads as 80 and the flag rejects it. Closes #1030.

Upgrade note: a config that relied on a hex, exponent or signed port string (for example `"0x50"`) no longer loads. Write the port as a plain decimal number or string instead.
