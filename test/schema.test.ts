import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildInputSchema, normalizeOpenApiSchema } from "../src/schema/index.js";
import type { ParsedOperation } from "../src/types.js";

const operation: ParsedOperation = {
  toolName: "getPetById",
  method: "get",
  path: "/pets/{petId}",
  baseUrl: "https://api.example.com",
  parameters: [
    {
      name: "petId",
      in: "path",
      required: true,
      schema: { type: "string" },
    },
    {
      name: "verbose",
      in: "query",
      required: false,
      schema: { type: "boolean" },
    },
  ],
};

describe("buildInputSchema", () => {
  it("maps parameters to properties and required list", () => {
    const schema = buildInputSchema(operation);
    assert.equal(schema.type, "object");
    assert.equal(schema.properties?.petId.type, "string");
    assert.equal(schema.properties?.verbose.type, "boolean");
    assert.deepEqual(schema.required, ["petId"]);
    assert.equal(schema.additionalProperties, false);
  });

  it("nests a required request body under `body`", () => {
    const withBody: ParsedOperation = {
      ...operation,
      requestBody: {
        required: true,
        contentType: "application/json",
        schema: { type: "object", properties: { name: { type: "string" } } },
      },
    };
    const schema = buildInputSchema(withBody);
    assert.equal(schema.properties?.body.type, "object");
    assert.deepEqual(schema.required, ["petId", "body"]);
  });

  it("omits `required` when no parameter is required", () => {
    const optional: ParsedOperation = {
      ...operation,
      parameters: [{ name: "verbose", in: "query", required: false, schema: { type: "boolean" } }],
    };
    const schema = buildInputSchema(optional);
    assert.equal(schema.required, undefined);
  });
});

describe("normalizeOpenApiSchema", () => {
  it("converts OpenAPI 3.0 nullable to a null union", () => {
    const normalized = normalizeOpenApiSchema({ type: "string", nullable: true });
    assert.deepEqual(normalized.type, ["string", "null"]);
    assert.equal(normalized.nullable, undefined);
  });

  it("folds boolean exclusiveMinimum into the numeric draft-07 form", () => {
    const normalized = normalizeOpenApiSchema({
      type: "number",
      minimum: 5,
      exclusiveMinimum: true,
    });
    assert.equal(normalized.exclusiveMinimum, 5);
    assert.equal(normalized.minimum, undefined);
  });

  it("returns a copy and recurses into nested schemas", () => {
    const input = {
      type: "object",
      nullable: true,
      properties: {
        tags: {
          type: "array",
          nullable: true,
          items: { type: "string", nullable: true },
        },
      },
    };
    const normalized = normalizeOpenApiSchema(input);
    assert.notEqual(normalized, input);
    assert.equal(normalized.type, "object");
    assert.deepEqual(normalized.properties?.tags?.type, ["array", "null"]);
    assert.ok(
      normalized.properties?.tags?.items && !Array.isArray(normalized.properties.tags.items),
    );
    assert.deepEqual(
      (
        normalized.properties?.tags?.items as {
          type?: string | string[];
        }
      ).type,
      ["string", "null"],
    );
  });
});
