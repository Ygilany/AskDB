# @askdb/prisma

Prisma schema-file introspection for AskDB.

`@askdb/prisma` reads one `schema.prisma` file or a directory of `.prisma` files and produces the same physical schema artifact used by the rest of AskDB. It does not connect to the database and does not execute generated SQL.

```ts
import { introspect } from "@askdb/introspect";
import { createPrismaConnector } from "@askdb/prisma";

const result = await introspect(
  { schemaPath: "./prisma", schemaId: "my-app" },
  { outDir: "my-app.schema", schemaId: "my-app" },
  { connector: createPrismaConnector() },
);
```

CLI: `askdb` and `@askdb/studio` load this package only for Prisma introspection and don't install it, so add it to your project next to them. It depends on Prisma, whose `@prisma/engines` build pnpm 11 must approve (`pnpm add --allow-build=@prisma/engines @askdb/prisma ai` on pnpm 10.4 or later; see [the Prisma guide](https://askdb.tools/guides/integrations/prisma/#install)).

```sh
askdb introspect --engine prisma --prisma-schema ./prisma --out my-app.schema
askdb introspect --engine prisma --prisma-schema ./prisma/schema.prisma --print
askdb introspect --engine prisma --prisma-schema ./prisma --diff my-app.schema
```

Supported Prisma datasource providers are `postgresql`, `mysql`, `sqlite`, `sqlserver`, and `cockroachdb`. MongoDB is not supported because AskDB's schema artifact and SQL generation are relational.

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
