import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeResponse } from "../src/sanitizer/index.js";

const OPTIONS = {
  maxChars: 200,
  maxDepth: 3,
  maxArrayLength: 2,
  maxStringLength: 10,
};

describe("sanitizeResponse", () => {
  it("passes through small JSON unchanged", () => {
    const result = sanitizeResponse(JSON.stringify({ a: 1, b: "hi" }), OPTIONS);
    assert.equal(result.truncated, false);
    assert.equal(result.text, '{"a":1,"b":"hi"}');
  });

  it("truncates long strings with a marker", () => {
    const result = sanitizeResponse(JSON.stringify({ name: "a".repeat(100) }), OPTIONS);
    assert.equal(result.truncated, true);
    assert.ok(result.text.includes("…[truncated]"));
  });

  it("slices arrays beyond maxArrayLength", () => {
    const result = sanitizeResponse(JSON.stringify({ items: [1, 2, 3, 4] }), OPTIONS);
    assert.equal(result.truncated, true);
    const parsed = JSON.parse(result.text) as { items: unknown[] };
    assert.equal(parsed.items.length, 2);
  });

  it("drops values deeper than maxDepth", () => {
    const deep = JSON.stringify({ a: { b: { c: { d: { e: 1 } } } } });
    const result = sanitizeResponse(deep, OPTIONS);
    assert.equal(result.truncated, true);
  });

  it("truncates plain (non-JSON) text", () => {
    const result = sanitizeResponse("plain text ".repeat(50), OPTIONS);
    assert.equal(result.truncated, true);
    assert.ok(result.text.endsWith("…[truncated]"));
  });

  it("leaves everything intact when no limits are configured", () => {
    const raw = JSON.stringify({
      name: "p".repeat(5000),
      items: Array.from({ length: 500 }, (_, i) => i),
      deep: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } },
    });
    const result = sanitizeResponse(raw, {});
    assert.equal(result.truncated, false);
    const parsed = JSON.parse(result.text) as {
      name: string;
      items: number[];
      deep: unknown;
    };
    assert.equal(parsed.name.length, 5000);
    assert.equal(parsed.items.length, 500);
    assert.deepEqual(parsed.deep, { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } });
  });
});
