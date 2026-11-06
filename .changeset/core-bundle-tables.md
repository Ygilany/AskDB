---
"@askdb/core": patch
---

`loadSchema()` and `loadSchemaFromJson()` throw `SchemaParseError` for a bundle whose `tables` is missing, isn't an object, or holds a value that isn't a string, and the message names `tables` and the bundle (#797). A missing or `null` `tables` used to throw a raw `TypeError`, and a string or an array was read as if each character or item were a file. `askdb bundle` always writes `tables`, `{}` included.
