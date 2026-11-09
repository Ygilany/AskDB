---
"askdb": patch
---

`askdb ask` and `askdb bundle` print the new `unknown_key` loader warning on stderr, for example `Warning: schema.json has a key AskDB doesn't read, "sensitve" on table:public.users#email; did you mean "sensitive"?` (#690).
