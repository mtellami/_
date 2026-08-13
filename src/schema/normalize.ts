import type { JsonSchema } from "../types.js";

const SCHEMA_MAP_KEYWORDS = ["properties", "patternProperties", "$defs", "definitions"] as const;

const SCHEMA_ARRAY_KEYWORDS = ["allOf", "anyOf", "oneOf", "prefixItems", "items"] as const;

const SCHEMA_KEYWORDS = [
  "items",
  "additionalProperties",
  "unevaluatedProperties",
  "additionalItems",
  "unevaluatedItems",
  "propertyNames",
  "contains",
  "not",
  "if",
  "then",
  "else",
] as const;

/**
 * Normalizes an OpenAPI schema so it can be consumed by an Ajv draft-07
 * validator:
 *
 * - OpenAPI 3.0 `nullable: true` becomes a `["<type>", "null"]` union.
 * - OpenAPI 3.0 boolean `exclusiveMinimum`/`exclusiveMaximum` markers are
 *   folded into the numeric draft-07 form.
 *
 * Sub-schemas in every schema-position keyword are normalized recursively,
 * including `additionalProperties`, `patternProperties`, `$defs` and
 * `if`/`then`/`else`.
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

  for (const keyword of SCHEMA_MAP_KEYWORDS) {
    const map = copy[keyword] as Record<string, JsonSchema> | undefined;
    if (map && typeof map === "object" && !Array.isArray(map)) {
      for (const [key, value] of Object.entries(map)) {
        if (isSchema(value)) {
          map[key] = normalizeOpenApiSchema(value);
        }
      }
    }
  }

  for (const keyword of SCHEMA_ARRAY_KEYWORDS) {
    const list = copy[keyword];
    if (Array.isArray(list)) {
      copy[keyword] = list.filter(isSchema).map((sub) => normalizeOpenApiSchema(sub));
    }
  }

  for (const keyword of SCHEMA_KEYWORDS) {
    const value = copy[keyword];
    if (isSchema(value)) {
      copy[keyword] = normalizeOpenApiSchema(value);
    }
  }

  return copy;
}

function isSchema(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
