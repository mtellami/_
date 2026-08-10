import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { prepareRequest } from "../src/http/index.js";
import type { ParsedOperation } from "../src/types.js";

function makeOperation(overrides: Partial<ParsedOperation> = {}): ParsedOperation {
  return {
    toolName: "getPet",
    method: "get",
    path: "/pets/{petId}",
    baseUrl: "https://api.example.com",
    parameters: [],
    ...overrides,
  };
}

describe("prepareRequest", () => {
  it("joins baseUrl and path and appends query params", () => {
    const op = makeOperation({
      parameters: [
        { name: "petId", in: "path", required: true, schema: { type: "string" } },
        { name: "limit", in: "query", required: false, schema: { type: "integer" } },
        { name: "verbose", in: "query", required: false, schema: { type: "boolean" } },
      ],
    });
    const req = prepareRequest(op, { petId: "a/1", limit: 10, verbose: true }, op.baseUrl!, 1000);
    assert.equal(req.url, "https://api.example.com/pets/a%2F1?limit=10&verbose=true");
    assert.equal(req.method, "get");
  });

  it("applies header and cookie parameters", () => {
    const op = makeOperation({
      path: "/whoami",
      parameters: [
        { name: "X-Token", in: "header", required: false, schema: { type: "string" } },
        { name: "session", in: "cookie", required: false, schema: { type: "string" } },
      ],
    });
    const req = prepareRequest(op, { "X-Token": "abc", session: "s x" }, op.baseUrl!, 1000);
    assert.equal(req.headers["x-token"], "abc");
    assert.equal(req.headers.cookie, "session=s%20x");
  });

  it("sets JSON body and content-type when a request body is provided", () => {
    const op = makeOperation({
      method: "post",
      path: "/pets",
      requestBody: {
        required: true,
        contentType: "application/json",
        schema: { type: "object" },
      },
    });
    const req = prepareRequest(op, { body: { name: "Rex" } }, op.baseUrl!, 1000);
    assert.equal(req.headers["content-type"], "application/json");
    assert.deepEqual(req.body, { name: "Rex" });
  });

  it("omits the body when the operation defines one but none is passed", () => {
    const op = makeOperation({
      method: "post",
      path: "/pets",
      requestBody: { required: false, contentType: "application/json", schema: {} },
    });
    const req = prepareRequest(op, {}, op.baseUrl!, 1000);
    assert.equal(req.body, undefined);
    assert.equal(req.headers["content-type"], undefined);
  });

  it("defaults to JSON accept header", () => {
    const req = prepareRequest(makeOperation(), {}, "https://api.example.com", 1000);
    assert.equal(req.headers.accept, "application/json");
  });
});
