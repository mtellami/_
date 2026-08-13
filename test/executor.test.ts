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
  security: [],
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

  it("injects a bearer token for http/bearer operations", async () => {
    const headers: Record<string, string> = {};
    const runtime = makeContext({ auth: { bearerToken: "tok-1" } }, async (_url, init) => {
      Object.assign(headers, init?.headers);
      return new Response("ok", { status: 200 });
    });
    const protectedOp: ParsedOperation = {
      ...operation,
      security: [{ type: "http", scheme: "bearer" }],
    };
    await executeOperation(runtime, protectedOp, { petId: "p1" });
    assert.equal(headers.authorization, "Bearer tok-1");
  });

  it("does not send credentials to public operations", async () => {
    const headers: Record<string, string> = {};
    const runtime = makeContext({ auth: { bearerToken: "tok-1" } }, async (_url, init) => {
      Object.assign(headers, init?.headers);
      return new Response("ok", { status: 200 });
    });
    await executeOperation(runtime, operation, { petId: "p1" });
    assert.equal(headers.authorization, undefined);
  });

  it("injects an apiKey header from the apiKey security scheme", async () => {
    const headers: Record<string, string> = {};
    const runtime = makeContext({ auth: { apiKey: "k-9" } }, async (_url, init) => {
      Object.assign(headers, init?.headers);
      return new Response("ok", { status: 200 });
    });
    const protectedOp: ParsedOperation = {
      ...operation,
      security: [{ type: "apiKey", name: "X-API-Key", in: "header" }],
    };
    await executeOperation(runtime, protectedOp, { petId: "p1" });
    assert.equal(headers["x-api-key"], "k-9");
  });

  it("appends an apiKey query parameter when the scheme is in query", async () => {
    const urls: string[] = [];
    const runtime = makeContext({ auth: { apiKey: "k-9" } }, async (url) => {
      urls.push(String(url));
      return new Response("ok", { status: 200 });
    });
    const protectedOp: ParsedOperation = {
      ...operation,
      security: [{ type: "apiKey", name: "api_key", in: "query" }],
    };
    await executeOperation(runtime, protectedOp, { petId: "p1" });
    assert.equal(urls[0], "https://api.example.com/pets/p1?api_key=k-9");
  });

  it("sends basic auth from username and password", async () => {
    const headers: Record<string, string> = {};
    const runtime = makeContext(
      { auth: { username: "alice", password: "s3cret" } },
      async (_url, init) => {
        Object.assign(headers, init?.headers);
        return new Response("ok", { status: 200 });
      },
    );
    const protectedOp: ParsedOperation = {
      ...operation,
      security: [{ type: "http", scheme: "basic" }],
    };
    await executeOperation(runtime, protectedOp, { petId: "p1" });
    assert.equal(headers.authorization, `Basic ${Buffer.from("alice:s3cret").toString("base64")}`);
  });

  it("applies raw auth headers to every request", async () => {
    const headers: Record<string, string> = {};
    const runtime = makeContext(
      { auth: { headers: { "X-Proxy-Auth": "abc" } } },
      async (_url, init) => {
        Object.assign(headers, init?.headers);
        return new Response("ok", { status: 200 });
      },
    );
    await executeOperation(runtime, operation, { petId: "p1" });
    assert.equal(headers["x-proxy-auth"], "abc");
  });
});
