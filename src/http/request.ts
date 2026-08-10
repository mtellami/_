import type { HttpRequestContext, ParsedOperation } from "../types.js";

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
