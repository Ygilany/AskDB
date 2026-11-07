---
"askdb": minor
---

`askdb bundle` refuses a schema directory `loadSchema()` refuses, and exits 1 with the loader's error before it writes anything (#796). It used to bundle markdown the loader refuses, such as front-matter that isn't YAML, a tenant policy that doesn't parse, or two table files with the same `id`, and exit 0, so the bundle failed only when a service loaded it. On a failure it writes nothing, and a file already at `--out` stays as it was. A bundle it writes always loads. The check is `@askdb/enrich`'s `bundleSchemaDirectory()`, which the command calls.
