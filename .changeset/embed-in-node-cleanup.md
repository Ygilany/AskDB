---
---

docs(embed): clarify artifact path, note optional driver, trim redundant sections

- Embed-in-Node guide: add comment and prose paragraph explaining that `./my-app.schema` is the artifact *directory* (not a file) written by `askdb introspect`, and that `loadSchema` autodetects a directory, bundled JSON, or bare `schema.json`
- Add `<Aside>` callout after the handler example noting that `pg` is optional — any ORM or query builder (Prisma, Drizzle, Sequelize, Knex) can receive the returned SQL string directly
- Remove the "Behind an HTTP route" section (hand-rolled `node:http` server); the dedicated Deploy as HTTP service guide owns that surface
- Remove the "Handling errors" section (generic try/catch); the guide now stays focused on its actual subject: load schema → `ask()` → run SQL with your own client
