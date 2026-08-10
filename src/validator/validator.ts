import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import addFormatsModule from "ajv-formats";
import type { JsonSchema } from "../types.js";

type AjvInstance = InstanceType<typeof Ajv>;
const addFormats = addFormatsModule as unknown as (ajv: AjvInstance) => AjvInstance;

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  allowUnionTypes: true,
  validateFormats: true,
});
addFormats(ajv);

const cache = new WeakMap<object, ValidateFunction>();

export type ValidationOutcome = { ok: true; value: unknown } | { ok: false; errors: string[] };

export function validateData(schema: JsonSchema, value: unknown): ValidationOutcome {
  const validate = getValidator(schema);
  const valid = validate(value);
  if (valid) {
    return { ok: true, value };
  }
  return { ok: false, errors: formatErrors(validate.errors ?? []) };
}

function getValidator(schema: JsonSchema): ValidateFunction {
  const cached = cache.get(schema);
  if (cached) {
    return cached;
  }
  const validate = ajv.compile(schema);
  cache.set(schema, validate);
  return validate;
}

function formatErrors(errors: ErrorObject[]): string[] {
  return errors.map((error) => {
    const path = error.instancePath || "/";
    const params = describeParams(error);
    return `${path} ${error.message}${params ? ` (${params})` : ""}`;
  });
}

function describeParams(error: ErrorObject): string {
  const params = error.params as Record<string, unknown> | undefined;
  if (!params) {
    return "";
  }
  const parts = Object.entries(params)
    .filter(([key]) => key !== "type")
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`);
  return parts.join(", ");
}
