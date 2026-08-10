import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { executeOperation } from "../src/http/index.js";
import { HttpExecutionError } from "../src/errors.js";
import type { ParsedOperation, RuntimeContext } from "../src/types.js";
import type { Logger } from "../src/logger.js";
import type { BridgeConfig } from "../src/config.js";

const logger = { child: () => logger } as never as Logger;

function makeContext(
  overrides: Partial<BridgeConfig> = {},
  fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
): RuntimeContext {
  const config: BridgeConfig = {
    source: "./openapi.yaml",
    timeoutMs: 5_000,
    maxResponseChars: 200_000,
    maxDepth: 8,
    maxArrayLength: 100,
    maxStringLength: 2_000,
    logLevel: "info",
    serverName: "openapi-mcp-bridge",
    serverVersion: "0.1.0",
    allowInsecureHttp: false,
    ...overrides,
  };
  return { config, logger, fetchImpl };
}

const operation: ParsedOperation = {
  toolName: "getPet",
  method: "get",
  path: "/pets/{petId}",
  baseUrl: "https://api.example.com",
  parameters: [{ name: "petId", in: "path", required: true, schema: { type: "string" } }],
};

describe("executeOperation", () => {
  it("calls the target API and returns status, headers and body", async () => {
    const calls: string[] = [];
    const runtime = makeContext({}, async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ id: 1 }), {
        status: 201,
        statusText: "Created",
        headers: { "content-type": "application/json" },
      });
    });
    const result = await executeOperation(runtime, operation, { petId: "p1" });
    assert.equal(result.status, 201);
    assert.equal(result.bodyText, JSON.stringify({ id: 1 }));
    assert.equal(result.headers["content-type"], "application/json");
    assert.deepEqual(calls, ["https://api.example.com/pets/p1"]);
  });

  it("honors the API_BASE_URL override", async () => {
    let called = "";
    const runtime = makeContext({ baseUrlOverride: "https://staging.example.com" }, async (url) => {
      called = String(url);
      return new Response("ok", { status: 200 });
    });
    await executeOperation(runtime, operation, { petId: "p1" });
    assert.equal(called, "https://staging.example.com/pets/p1");
  });

  it("throws when no server URL is available", async () => {
    const runtime = makeContext({ baseUrlOverride: "" });
    const noBase: ParsedOperation = { ...operation, baseUrl: "" };
    await assert.rejects(() => executeOperation(runtime, noBase, { petId: "p1" }), {
      name: "HttpExecutionError",
    });
  });

  it("refuses insecure http targets by default", async () => {
    const runtime = makeContext();
    const insecure: ParsedOperation = { ...operation, baseUrl: "http://api.insecure.com" };
    await assert.rejects(
      () => executeOperation(runtime, insecure, { petId: "p1" }),
      HttpExecutionError,
    );
  });

  it("allows insecure http targets when enabled", async () => {
    let called = "";
    const runtime = makeContext({ allowInsecureHttp: true }, async (url) => {
      called = String(url);
      return new Response("ok", { status: 200 });
    });
    const insecure: ParsedOperation = { ...operation, baseUrl: "http://api.insecure.com" };
    const result = await executeOperation(runtime, insecure, { petId: "p1" });
    assert.equal(result.status, 200);
    assert.equal(called, "http://api.insecure.com/pets/p1");
  });

  it("surfaces timeouts as HttpExecutionError", async () => {
    const runtime = makeContext({ timeoutMs: 5 }, async (_url, init) => {
      const delay = new Promise((resolve) => setTimeout(resolve, 200));
      await new Promise<void>((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
        void delay.then(() => resolve());
      });
      return new Response("late", { status: 200 });
    });
    await assert.rejects(
      () => executeOperation(runtime, operation, { petId: "p1" }),
      HttpExecutionError,
    );
  });
});
