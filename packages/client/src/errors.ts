import { AskDbError } from "@askdb/core";

/** No schema source was provided or discoverable from config. */
export class SchemaNotConfiguredError extends AskDbError {
  constructor(message: string) {
    super(message);
    this.name = "SchemaNotConfiguredError";
  }
}

/** loadSchema / loadSchemaFromJson failed (bad JSON, missing file, etc.). */
export class SchemaLoadError extends AskDbError {
  constructor(
    readonly source: string,
    cause: unknown,
  ) {
    super(`schema load failed (${source}): ${cause instanceof Error ? cause.message : String(cause)}`, cause);
    this.name = "SchemaLoadError";
  }
}

/** schema.provider has no shipped DialectSpec and no config/override dialect was set. */
export class DialectNotSupportedError extends AskDbError {
  constructor(
    readonly provider: string,
    message: string,
  ) {
    super(message);
    this.name = "DialectNotSupportedError";
  }
}

/** No model override, no mock, and the registry could not build a model. */
export class ModelNotConfiguredError extends AskDbError {
  constructor(message: string) {
    super(message);
    this.name = "ModelNotConfiguredError";
  }
}
