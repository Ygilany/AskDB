---
"@askdb/core": minor
---

`loadSchema()` and `loadSchemaFromJson()` throw `SchemaParseError` for a bundle whose `tables` is missing, isn't an object, or holds a value that isn't a string, and the message names `tables` and the bundle (#797). A missing or `null` `tables` used to throw a raw `TypeError`. A `tables` of `[]`, `""`, `0` or `true` used to load as a schema with no table files, and now throws too: set it to `{}`. A non-empty string or array was read as if each character or item were a file. `askdb bundle` always writes `tables`, `{}` included.
