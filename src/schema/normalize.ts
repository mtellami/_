import type { JsonSchema } from "../types.js";

/**
 * Normalizes an OpenAPI schema so it can be consumed by an Ajv draft-07
 * validator:
 *
 * - OpenAPI 3.0 `nullable: true` becomes a `["<type>", "null"]` union.
 * - OpenAPI 3.0 boolean `exclusiveMinimum`/`exclusiveMaximum` markers are
 *   folded into the numeric draft-07 form.
 */
export function normalizeOpenApiSchema(schema: JsonSchema): JsonSchema {
  const copy: JsonSchema = { ...schema };

  if (copy.nullable === true && copy.type) {
    const type = copy.type;
    const types = Array.isArray(type) ? [...type] : [type];
    if (!types.includes("null")) {
      types.push("null");
    }
    copy.type = types;
  }
  delete copy.nullable;

  if (copy.exclusiveMinimum === true && typeof copy.minimum === "number") {
    copy.exclusiveMinimum = copy.minimum;
    delete copy.minimum;
  } else if (typeof copy.exclusiveMinimum !== "number") {
    delete copy.exclusiveMinimum;
  }

  if (copy.exclusiveMaximum === true && typeof copy.maximum === "number") {
    copy.exclusiveMaximum = copy.maximum;
    delete copy.maximum;
  } else if (typeof copy.exclusiveMaximum !== "number") {
    delete copy.exclusiveMaximum;
  }

  if (copy.properties) {
    const properties: Record<string, JsonSchema> = {};
    for (const [key, value] of Object.entries(copy.properties)) {
      properties[key] = normalizeOpenApiSchema(value);
    }
    copy.properties = properties;
  }

  if (Array.isArray(copy.items)) {
    copy.items = copy.items.map((item) => normalizeOpenApiSchema(item));
  } else if (copy.items) {
    copy.items = normalizeOpenApiSchema(copy.items);
  }

  for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
    if (Array.isArray(copy[keyword])) {
      copy[keyword] = copy[keyword].map((sub) => normalizeOpenApiSchema(sub));
    }
  }

  return copy;
}
