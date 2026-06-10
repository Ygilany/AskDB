# @askdb/prisma

Prisma schema-file introspection for AskDB.

`@askdb/prisma` reads one `schema.prisma` file or a directory of `.prisma` files and produces the same Schema v2 physical artifact used by the rest of AskDB. It does not connect to the database and does not execute generated SQL.

```ts
import { introspect } from "@askdb/introspect";
import { createPrismaConnector } from "@askdb/prisma";

const result = await introspect(
  { schemaPath: "./prisma", schemaId: "my-app" },
  { outDir: "my-app.schema", schemaId: "my-app" },
  { connector: createPrismaConnector() },
);
```

CLI:

```sh
askdb introspect --engine prisma --prisma-schema ./prisma --out my-app.schema
askdb introspect --engine prisma --prisma-schema ./prisma/schema.prisma --print
askdb introspect --engine prisma --prisma-schema ./prisma --diff my-app.schema
```

Supported Prisma datasource providers are `postgresql`, `mysql`, `sqlite`, `sqlserver`, and `cockroachdb`. MongoDB is not supported because AskDB Schema v2 and SQL generation are relational.

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
