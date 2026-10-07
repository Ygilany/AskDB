// What a model writes when it copies table names exactly as AskDB's NL→SQL prompt lists
// them (#451), for engine suites to run against the multi-engine fixture.
//
// Plain ESM + a sibling `.d.mts`, like `integration.mjs`. `ask` is passed in so this file
// doesn't resolve `@askdb/core` from outside a package.

const QUOTES = /["`[\]]/g;

/** The fixture's `billing.order` is a reserved word on every engine. See the `.d.mts`. */
export async function askCopyingListedTableNames(ask, schema, dialect) {
  const result = await ask({
    question: "How many orders are there?",
    schema,
    dialect,
    model: /** @type {never} */ ({}),
    parameterize: false,
    deps: {
      generateText: /** @type {never} */ (
        async (/** @type {{ prompt: string }} */ { prompt }) => {
          const listed = [...prompt.matchAll(/^TABLE (\S+)$/gm)].map((m) => m[1]);
          /** @param {string} table */
          const named = (table) => {
            const hit = listed.find((name) => {
              const bare = name.replace(QUOTES, "");
              return bare === table || bare.endsWith(`.${table}`);
            });
            if (!hit) throw new Error(`the prompt lists no table ${table}: ${listed.join(", ")}`);
            return hit;
          };
          const sql = `SELECT COUNT(*) AS n FROM ${named("order")} o JOIN ${named("agency")} a ON a.agency_id = o.agency_id`;
          return { text: "```sql\n" + sql + "\n```" };
        }
      ),
    },
  });
  return result.sql;
}
