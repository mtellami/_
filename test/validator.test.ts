import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateData } from "../src/validator/index.js";

describe("validateData", () => {
  const schema = {
    type: "object",
    properties: {
      id: { type: "string", minLength: 1 },
      email: { type: "string", format: "email" },
      tags: { type: "array", items: { type: "string" }, maxItems: 2 },
    },
    required: ["id"],
    additionalProperties: false,
  };

  it("accepts valid input", () => {
    const outcome = validateData(schema, {
      id: "p-1",
      email: "a@example.com",
      tags: ["x"],
    } as never);
    assert.equal(outcome.ok, true);
  });

  it("rejects a missing required property", () => {
    const outcome = validateData(schema, { email: "a@example.com" } as never);
    assert.equal(outcome.ok, false);
    assert.ok(!outcome.ok);
    assert.match(outcome.errors.join("\n"), /must have required property/);
  });

  it("rejects invalid formats", () => {
    const outcome = validateData(schema, { id: "x", email: "not-an-email" } as never);
    assert.equal(outcome.ok, false);
  });

  it("rejects unknown properties and over-long arrays", () => {
    const outcome = validateData(schema, { id: "x", extra: 1, tags: ["a", "b", "c"] } as never);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.errors.length, 2);
  });
});
