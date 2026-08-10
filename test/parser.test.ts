import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseOpenApiSpec,
  toToolName,
  uniqueToolName,
  dereferenceSchema,
} from "../src/parser/index.js";
import { SpecParseError } from "../src/errors.js";

const SPEC = `
openapi: "3.0.3"
info:
  title: Pet Store
  version: "1.0.0"
servers:
  - url: https://api.example.com
paths:
  /pets/{petId}:
    parameters:
      - name: petId
        in: path
        required: true
        schema:
          type: string
    get:
      operationId: getPetById
      summary: Get a pet
      description: Fetch a single pet by its id.
      parameters:
        - name: verbose
          in: query
          schema:
            type: boolean
      responses:
        "200":
          description: ok
    post:
      operationId: create_pet
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/Pet"
      responses:
        "201":
          description: created
components:
  schemas:
    Pet:
      type: object
      properties:
        name:
          type: string
      required: [name]
`;

describe("parseOpenApiSpec", () => {
  it("parses operations, baseUrl and metadata", () => {
    const parsed = parseOpenApiSpec(SPEC, "yaml");
    assert.equal(parsed.title, "Pet Store");
    assert.equal(parsed.version, "1.0.0");
    assert.equal(parsed.operations.length, 2);
    for (const op of parsed.operations) {
      assert.equal(op.baseUrl, "https://api.example.com");
    }
  });

  it("merges shared path parameters into operations", () => {
    const parsed = parseOpenApiSpec(SPEC, "yaml");
    const get = parsed.operations.find((op) => op.method === "get");
    assert.ok(get);
    const petId = get.parameters.find((p) => p.name === "petId");
    assert.ok(petId);
    assert.equal(petId.in, "path");
    assert.equal(petId.required, true);
    const verbose = get.parameters.find((p) => p.name === "verbose");
    assert.ok(verbose);
    assert.equal(verbose.in, "query");
    assert.equal(verbose.required, false);
  });

  it("dereferences request body schema refs", () => {
    const parsed = parseOpenApiSpec(SPEC, "yaml");
    const post = parsed.operations.find((op) => op.method === "post");
    assert.ok(post);
    assert.equal(post.requestBody?.contentType, "application/json");
    assert.equal(post.requestBody?.required, true);
    assert.deepEqual(post.requestBody?.schema?.type, "object");
    assert.deepEqual(post.requestBody?.schema?.required, ["name"]);
  });

  it("derives camelCase tool names from operationId", () => {
    const parsed = parseOpenApiSpec(SPEC, "yaml");
    const names = parsed.operations.map((op) => op.toolName).sort();
    assert.deepEqual(names, ["createPet", "getPetById"]);
  });

  it("rejects unsupported OpenAPI versions", () => {
    const bad = `openapi: "2.0"\ninfo: {title: X, version: "1"}\npaths: {}`;
    assert.throws(() => parseOpenApiSpec(bad, "yaml"), SpecParseError);
  });

  it("resolves relative server URLs against the spec origin", () => {
    const relative = `
openapi: "3.0.3"
info: {title: X, version: "1"}
servers:
  - url: /api/v3
paths:
  /pets:
    get:
      operationId: listPets
`;
    const parsed = parseOpenApiSpec(relative, "yaml", {
      specOrigin: "https://petstore.example.com",
    });
    assert.equal(parsed.operations.length, 1);
    assert.equal(parsed.operations[0]?.baseUrl, "https://petstore.example.com/api/v3");
  });

  it("rejects circular $ref schemas", () => {
    const circular = `
openapi: "3.0.3"
info: {title: X, version: "1"}
paths:
  /nodes:
    post:
      operationId: createNode
      requestBody:
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/Node"
components:
  schemas:
    Node:
      type: object
      properties:
        child:
          $ref: "#/components/schemas/Node"
`;
    assert.throws(() => parseOpenApiSpec(circular, "yaml"), SpecParseError);
  });
});

describe("toToolName", () => {
  it("normalizes camelCase, kebab, snake and spaces", () => {
    assert.equal(toToolName("getUserById"), "getUserById");
    assert.equal(toToolName("get-user-by-id"), "getUserById");
    assert.equal(toToolName("create_user"), "createUser");
    assert.equal(toToolName("list  pets"), "listPets");
    assert.equal(toToolName("!!!"), "operation");
  });
});

describe("uniqueToolName", () => {
  it("deduplicates with numeric suffixes", () => {
    const used = new Set<string>();
    assert.equal(uniqueToolName("getUser", used), "getUser");
    assert.equal(uniqueToolName("getUser", used), "getUser2");
    assert.equal(uniqueToolName("getUser", used), "getUser3");
  });
});

describe("dereferenceSchema", () => {
  it("resolves local component refs", () => {
    const root = {
      components: {
        schemas: {
          Pet: { type: "object", properties: { name: { type: "string" } } },
        },
      },
    } as never;
    const resolved = dereferenceSchema({ $ref: "#/components/schemas/Pet" }, root as never);
    assert.equal(resolved.type, "object");
    assert.equal(resolved.properties?.name.type, "string");
  });

  it("throws on unresolvable refs", () => {
    const root = { components: { schemas: {} } } as never;
    assert.throws(
      () => dereferenceSchema({ $ref: "#/components/schemas/Missing" }, root as never),
      SpecParseError,
    );
  });
});
