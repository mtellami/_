import { HttpExecutionError } from "../errors.js";
import type { HttpResult, ParsedOperation, RuntimeContext } from "../types.js";
import { prepareRequest } from "./request.js";

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

  if (!config.allowInsecureHttp && new URL(request.url).protocol === "http:") {
    throw new HttpExecutionError(
      `Refusing insecure HTTP request to "${request.url}"; set ALLOW_INSECURE_HTTP=true to allow plain http targets`,
    );
  }

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
