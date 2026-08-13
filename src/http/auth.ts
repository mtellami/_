import type { AuthConfig } from "../config.js";
import type { HttpRequestContext, ParsedOperation } from "../types.js";

/**
 * Injects configured credentials into a prepared request for the security
 * schemes the operation requires. Raw `headers` are applied to every request;
 * scheme-specific credentials are applied only when the operation declares the
 * matching scheme. Missing credentials for a required scheme are skipped.
 */
export function applyAuth(
  request: HttpRequestContext,
  operation: ParsedOperation,
  auth: AuthConfig | undefined,
): void {
  if (!auth) {
    return;
  }
  if (auth.headers) {
    for (const [name, value] of Object.entries(auth.headers)) {
      request.headers[name.toLowerCase()] = value;
    }
  }
  for (const scheme of operation.security ?? []) {
    switch (scheme.type) {
      case "apiKey": {
        if (!auth.apiKey) {
          break;
        }
        if (scheme.in === "header") {
          request.headers[scheme.name.toLowerCase()] = auth.apiKey;
        } else if (scheme.in === "query") {
          addQueryParam(request, scheme.name, auth.apiKey);
        } else if (scheme.in === "cookie") {
          appendCookie(request, scheme.name, auth.apiKey);
        }
        break;
      }
      case "http": {
        if (scheme.scheme.toLowerCase() === "basic") {
          if (auth.username) {
            const token = `${auth.username}:${auth.password ?? ""}`;
            request.headers.authorization = `Basic ${toBase64(token)}`;
          }
        } else if (scheme.scheme.toLowerCase() === "bearer") {
          if (auth.bearerToken) {
            request.headers.authorization = `Bearer ${auth.bearerToken}`;
          }
        }
        break;
      }
      case "oauth2":
      case "openIdConnect": {
        if (auth.bearerToken) {
          request.headers.authorization = `Bearer ${auth.bearerToken}`;
        }
        break;
      }
    }
  }
}

function addQueryParam(request: HttpRequestContext, name: string, value: string): void {
  const url = new URL(request.url);
  url.searchParams.append(name, value);
  request.url = url.toString();
}

function appendCookie(request: HttpRequestContext, name: string, value: string): void {
  const part = `${name}=${encodeURIComponent(value)}`;
  request.headers.cookie = request.headers.cookie ? `${request.headers.cookie}; ${part}` : part;
}

function toBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}
