---
"askdb": patch
---

`askdb ask` and `askdb init` no longer print an empty error detail for an error that has no message of its own (#781). Three places printed `error.message`, which is empty for one: the `errMessage` of `askdb ask`'s `askdb.run.error` log event, the `Details:` line when `askdb ask` can't load the schema, and `askdb init`'s `Failed to write config:` line. They now print what `askdb introspect` prints since #749: each inner error's message for an `AggregateError`, else the error's `code`, else its name.
