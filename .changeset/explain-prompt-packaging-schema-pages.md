---
---

docs: explain how the schema artifact is repackaged for the model prompt

Add "What the model actually receives" section to the schema-artifact concept page (between the enrichment layer and stable IDs sections), and "How enrichment reaches the model" section to the author-your-schema guide (before "Read next"). Both sections explain that AskDB merges the physical schema and enrichment into a DDL-style text with enrichment as inline comments — clarifying what the model actually sees and why enrichment written as plain-language descriptions is effective.
