/**
 * The shared multi-engine fixture (`fixtures/multi-engine`): its connection URLs, logical
 * schemas and dataset. Imported by path, not installed. The fixture never imports AskDB
 * and its public module loads no database driver, so this adds nothing to what the lab
 * resolves from the install target.
 */
export {
  DIALECTS,
  LOGICAL_SCHEMAS,
  connectionUrl,
  type Dialect,
} from "../../../fixtures/multi-engine/src/index.js";
