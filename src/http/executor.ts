import { HttpExecutionError } from "../errors.js";
import type { HttpRequestContext, HttpResult, ParsedOperation, RuntimeContext } from "../types.js";

export function prepareRequest(
  operation: ParsedOperation,
  args: Record<string, unknown>,
  baseUrl: string,
  timeoutMs: number,
): HttpRequestContext {
  const path = substitutePathParams(operation.path, operation, args);
  const headers: Record<string, string> = { accept: "application/json" };
  const query: [string, string][] = [];
  const cookies: string[] = [];

  for (const parameter of operation.parameters) {
    const value = args[parameter.name];
    if (value === undefined || value === null) {
      continue;
    }
    switch (parameter.in) {
      case "query":
        query.push([parameter.name, serializeValue(value)]);
        break;
      case "header":
        headers[parameter.name.toLowerCase()] = serializeValue(value);
        break;
      case "cookie":
        cookies.push(`${parameter.name}=${encodeURIComponent(serializeValue(value))}`);
        break;
      case "path":
        break;
    }
  }

  let body: unknown;
  if (operation.requestBody) {
    const value = args.body;
    if (value !== undefined) {
      body = value;
      headers["content-type"] = operation.requestBody.contentType;
    }
  }

  if (cookies.length > 0) {
    headers.cookie = cookies.join("; ");
  }

  const url = buildUrl(baseUrl, path, query);
  return { url, method: operation.method, headers, body, timeoutMs };
}

export async function executeOperation(
  runtime: RuntimeContext,
  operation: ParsedOperation,
  args: Record<string, unknown>,
): Promise<HttpResult> {
  const config = runtime.config;
  const baseUrl = config.baseUrlOverride ?? operation.baseUrl;
  if (!baseUrl) {
    throw new HttpExecutionError(`No server URL available for operation "${operation.toolName}"`);
  }

  const request = prepareRequest(operation, args, baseUrl, config.timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);

  try {
    const init: RequestInit = {
      method: request.method.toUpperCase(),
      headers: request.headers,
      signal: controller.signal,
    };
    if (request.body !== undefined) {
      init.body = JSON.stringify(request.body);
    }

    const response = await runtime.fetchImpl(request.url, init);
    const bodyText = await response.text();

    return {
      url: request.url,
      method: request.method,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      bodyText,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new HttpExecutionError(
        `Request to ${request.url} timed out after ${request.timeoutMs}ms`,
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new HttpExecutionError(`HTTP request to ${request.url} failed: ${message}`, {
      cause: err,
    });
  } finally {
    clearTimeout(timer);
  }
}

function buildUrl(baseUrl: string, path: string, query: [string, string][]): string {
  const joined = baseUrl.replace(/\/+$/, "") + (path.startsWith("/") ? path : `/${path}`);
  const url = new URL(joined);
  for (const [key, value] of query) {
    url.searchParams.append(key, value);
  }
  return url.toString();
}

function substitutePathParams(
  path: string,
  operation: ParsedOperation,
  args: Record<string, unknown>,
): string {
  return path.replace(/\{([^}]+)\}/g, (match, rawName: string) => {
    const parameter = operation.parameters.find(
      (parameter) => parameter.in === "path" && parameter.name === rawName,
    );
    const value = parameter ? args[parameter.name] : undefined;
    if (value === undefined || value === null) {
      return match;
    }
    return encodeURIComponent(serializeValue(value));
  });
}

function serializeValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
