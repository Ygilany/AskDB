const config = require("@askdb/config");
const core = require("@askdb/core");

if (Object.keys(config).length === 0) {
  throw new Error("smoke(cjs): @askdb/config did not load");
}

for (const name of ["ask", "loadSchema", "AskDbError", "POSTGRES_DIALECT"]) {
  if (core[name] === undefined) {
    throw new Error(`smoke(cjs): @askdb/core is missing ${name}`);
  }
}

const error = new core.SqlValidationError("nope", "SQL_EMPTY");
if (!(error instanceof core.AskDbError)) {
  throw new Error("smoke(cjs): error hierarchy did not preserve instanceof");
}

console.log("smoke(cjs): OK");
