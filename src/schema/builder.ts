import type { JsonSchema, ParsedOperation } from "../types.js";
import { normalizeOpenApiSchema } from "./normalize.js";

/**
 * Builds the MCP tool input schema for an operation:
 *
 * - `path`, `query`, `header` and `cookie` parameters become top-level
 *   properties (required ones are listed under `required`).
 * - The request body is nested under a single `body` property, which is
 *   required when the spec marks it as such.
 */
export function buildInputSchema(operation: ParsedOperation): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const parameter of operation.parameters) {
    const schema = parameter.schema ? normalizeOpenApiSchema(parameter.schema) : {};
    properties[parameter.name] = schema;
    if (parameter.required) {
      required.push(parameter.name);
    }
  }

  if (operation.requestBody) {
    const bodySchema = operation.requestBody.schema
      ? normalizeOpenApiSchema(operation.requestBody.schema)
      : {};
    properties.body = bodySchema;
    if (operation.requestBody.required) {
      required.push("body");
    }
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}
