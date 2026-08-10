import { readFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { SpecLoadError } from "../errors.js";

export interface LoadedSpec {
  source: string;
  text: string;
  format: "json" | "yaml";
}

export interface LoadSpecOptions {
  maxBytes?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** When false (default), refusing to fetch specs from plain `http://` URLs. */
  allowInsecureHttp?: boolean;
}

export function isHttpSource(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

export function inferFormat(source: string, text: string): "json" | "yaml" {
  if (/\.json$/i.test(source)) {
    return "json";
  }
  if (/\.(ya?ml)$/i.test(source)) {
    return "yaml";
  }
  return text.trimStart().startsWith("{") ? "json" : "yaml";
}

export async function loadSpec(source: string, options: LoadSpecOptions = {}): Promise<LoadedSpec> {
  if (isHttpSource(source)) {
    return loadFromHttp(source, options);
  }
  return loadFromFile(source, options);
}

async function loadFromFile(source: string, options: LoadSpecOptions): Promise<LoadedSpec> {
  try {
    const s = await stat(source);
    if (options.maxBytes && s.size > options.maxBytes) {
      throw new SpecLoadError(
        `Spec file "${source}" is ${s.size} bytes, exceeding the ${options.maxBytes} byte limit`,
      );
    }
    const text = await readFile(source, "utf8");
    return { source, text, format: inferFormat(source, text) };
  } catch (err) {
    if (err instanceof SpecLoadError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new SpecLoadError(`Failed to read spec from file "${source}": ${message}`, {
      cause: err,
    });
  }
}

async function loadFromHttp(source: string, options: LoadSpecOptions): Promise<LoadedSpec> {
  if (options.allowInsecureHttp !== true && /^http:\/\//i.test(source)) {
    throw new SpecLoadError(
      `Refusing to fetch spec over insecure HTTP from "${source}"; set ALLOW_INSECURE_HTTP=true to allow it`,
    );
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(source, { signal: controller.signal });
    if (!response.ok) {
      throw new SpecLoadError(
        `Failed to fetch spec from "${source}": HTTP ${response.status} ${response.statusText}`,
      );
    }
    const text = await response.text();
    if (options.maxBytes && text.length > options.maxBytes) {
      throw new SpecLoadError(
        `Spec from "${source}" is ${text.length} characters, exceeding the ${options.maxBytes} byte limit`,
      );
    }
    return { source, text, format: inferFormat(source, text) };
  } catch (err) {
    if (err instanceof SpecLoadError) {
      throw err;
    }
    const aborted = err instanceof Error && err.name === "AbortError";
    const message = aborted
      ? `timed out after ${timeoutMs}ms`
      : err instanceof Error
        ? err.message
        : String(err);
    throw new SpecLoadError(`Failed to load spec from "${source}": ${message}`, { cause: err });
  } finally {
    clearTimeout(timer);
  }
}
