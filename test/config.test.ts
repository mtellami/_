import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { ConfigError } from "../src/errors.js";
import { loadSpec, inferFormat } from "../src/loader/index.js";
import { SpecLoadError } from "../src/errors.js";

describe("loadConfig", () => {
  it("requires OPENAPI_SOURCE", () => {
    assert.throws(() => loadConfig({}), ConfigError);
  });

  it("applies defaults for optional settings", () => {
    const config = loadConfig({ OPENAPI_SOURCE: "./openapi.yaml" });
    assert.equal(config.source, "./openapi.yaml");
    assert.equal(config.timeoutMs, 30_000);
    assert.equal(config.maxResponseChars, undefined);
    assert.equal(config.maxDepth, undefined);
    assert.equal(config.maxArrayLength, undefined);
    assert.equal(config.maxStringLength, undefined);
    assert.equal(config.logLevel, "info");
    assert.equal(config.serverName, "api-mcp-bridge");
    assert.equal(config.allowInsecureHttp, false);
  });

  it("applies limits only when explicitly configured", () => {
    const config = loadConfig({
      OPENAPI_SOURCE: "https://example.com/spec.json",
      API_MAX_RESPONSE_CHARS: "5000",
      SANITIZE_MAX_DEPTH: "4",
      SANITIZE_MAX_ARRAY_LENGTH: "25",
      SANITIZE_MAX_STRING_LENGTH: "100",
    });
    assert.equal(config.maxResponseChars, 5_000);
    assert.equal(config.maxDepth, 4);
    assert.equal(config.maxArrayLength, 25);
    assert.equal(config.maxStringLength, 100);
  });

  it("leaves limits unlimited when env values are empty", () => {
    const config = loadConfig({
      OPENAPI_SOURCE: "x.yaml",
      API_MAX_RESPONSE_CHARS: "",
      SANITIZE_MAX_ARRAY_LENGTH: "",
    });
    assert.equal(config.maxResponseChars, undefined);
    assert.equal(config.maxArrayLength, undefined);
  });

  it("parses numeric env values and insecure-http flag", () => {
    const config = loadConfig({
      OPENAPI_SOURCE: "https://example.com/spec.json",
      API_BASE_URL: "https://example.com",
      API_TIMEOUT_MS: "5000",
      API_MAX_RESPONSE_CHARS: "1000",
      LOG_LEVEL: "debug",
      ALLOW_INSECURE_HTTP: "true",
    });
    assert.equal(config.baseUrlOverride, "https://example.com");
    assert.equal(config.timeoutMs, 5_000);
    assert.equal(config.maxResponseChars, 1_000);
    assert.equal(config.logLevel, "debug");
    assert.equal(config.allowInsecureHttp, true);
  });

  it("falls back to defaults on empty numeric values", () => {
    const config = loadConfig({ OPENAPI_SOURCE: "x.yaml", API_TIMEOUT_MS: "" });
    assert.equal(config.timeoutMs, 30_000);
  });

  it("prefers the CLI source over the environment", () => {
    const config = loadConfig({ OPENAPI_SOURCE: "./env.yaml" }, "./cli.yaml");
    assert.equal(config.source, "./cli.yaml");
  });

  it("accepts a CLI source without OPENAPI_SOURCE", () => {
    const config = loadConfig({}, "./cli.yaml");
    assert.equal(config.source, "./cli.yaml");
  });

  it("parses headers from the environment", () => {
    const config = loadConfig({
      OPENAPI_SOURCE: "./openapi.yaml",
      API_HEADERS: '{"X-Proxy-Auth":"abc"}',
    });
    assert.deepEqual(config.headers, { "X-Proxy-Auth": "abc" });
  });

  it("leaves headers unset when none are provided", () => {
    const config = loadConfig({ OPENAPI_SOURCE: "./openapi.yaml" });
    assert.equal(config.headers, undefined);
  });

  it("rejects malformed API_HEADERS", () => {
    assert.throws(
      () => loadConfig({ OPENAPI_SOURCE: "./openapi.yaml", API_HEADERS: "not json" }),
      ConfigError,
    );
  });
});

describe("loader", () => {
  it("refuses insecure http sources by default", async () => {
    await assert.rejects(() => loadSpec("http://example.com/spec.yaml"), SpecLoadError);
  });

  it("allows insecure http sources when opted in", async () => {
    const spec = await loadSpec("http://example.com/spec.yaml", {
      allowInsecureHttp: true,
      fetchImpl: async () => new Response('openapi: "3.0.3"', { status: 200 }),
    });
    assert.equal(spec.format, "yaml");
  });

  it("forwards configured headers when fetching a remote spec", async () => {
    let captured: HeadersInit | undefined;
    const spec = await loadSpec("http://example.com/spec.yaml", {
      allowInsecureHttp: true,
      headers: { authorization: "Bearer tok", "x-proxy-auth": "abc" },
      fetchImpl: async (_url, init) => {
        captured = init?.headers;
        return new Response('openapi: "3.0.3"', { status: 200 });
      },
    });
    assert.equal(spec.format, "yaml");
    const headers = new Headers(captured);
    assert.equal(headers.get("authorization"), "Bearer tok");
    assert.equal(headers.get("x-proxy-auth"), "abc");
  });

  it("infers format from extension and content", () => {
    assert.equal(inferFormat("spec.json", "{}"), "json");
    assert.equal(inferFormat("spec.yaml", "{}"), "yaml");
    assert.equal(inferFormat("spec", '{"a":1}'), "json");
    assert.equal(inferFormat("spec", "openapi: 3.0.3"), "yaml");
  });
});
