/**
 * Subpath entry: `@askdb/core/postgres`.
 *
 * Holds the built-in `pg`-backed executor helpers. Imported separately from the main barrel so
 * consumers who only use a custom `executor` never even mention this module — and therefore
 * never need to install the optional `pg` peer dependency.
 *
 * See `docs/specs/phase-4-publish-npm/requirements.md` ("Postgres helper packaging").
 */
export {
  createPostgresExecutor,
  executeReadOnlySelect,
  type TabularResult,
} from "./exec/postgres.js";
