---
"@askdb/config": minor
---

**Breaking:** an unknown `studio.execute.provider` now fails to load with `askdb.config: invalid studio.execute.provider "<value>" (expected one of: postgres, mysql, sqlite, sqlserver).` (#751), like every other config key since #737. Before, it fell back without a word to the introspection provider, or `postgres`, so a typo could point Studio's Execute at an engine the config didn't name. An unset provider still falls back the same way. For this key and every other key with a fixed list of values, the error repeats a rejected value only when it's a bare word, so a connection string pasted into the wrong key isn't printed. The upgrade guide's beta.52 section shows the fix.
