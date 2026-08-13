import { z } from "zod";
import { ConfigError } from "./errors.js";
import { parseLogLevel, type LogLevel } from "./logger.js";

export interface BridgeConfig {
  /** Raw spec source: a filesystem path or an http(s) URL. */
  source: string;
  baseUrlOverride?: string;
  timeoutMs: number;
  maxTools: number;
  /** Response character budget. Unlimited when not set. */
  maxResponseChars?: number;
  /** Max JSON depth kept. Unlimited when not set. */
  maxDepth?: number;
  /** Max array elements kept per array. Unlimited when not set. */
  maxArrayLength?: number;
  /** Max length of an individual string value. Unlimited when not set. */
  maxStringLength?: number;
  logLevel: LogLevel;
  serverName: string;
  serverVersion: string;
  allowInsecureHttp: boolean;
  /** Raw headers injected into every request. */
  headers?: Record<string, string>;
}

export const DEFAULT_CONFIG = {
  timeoutMs: 30_000,
  maxTools: 100,
  serverName: "api-mcp-bridge",
  serverVersion: "0.1.0",
} as const;

const numberOrEmpty = (def: number) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
      return def;
    }
    if (typeof value === "number") {
      return value;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : def;
  }, z.number().min(0));

const optionalNumber = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "number") {
    return value;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}, z.number().min(0).optional());

const EnvSchema = z.object({
  OPENAPI_SOURCE: z.string().min(1).optional(),
  API_BASE_URL: z.string().min(1).optional(),
  API_TIMEOUT_MS: numberOrEmpty(DEFAULT_CONFIG.timeoutMs),
  OPENAPI_MAX_TOOLS: numberOrEmpty(DEFAULT_CONFIG.maxTools),
  API_MAX_RESPONSE_CHARS: optionalNumber,
  SANITIZE_MAX_DEPTH: optionalNumber,
  SANITIZE_MAX_ARRAY_LENGTH: optionalNumber,
  SANITIZE_MAX_STRING_LENGTH: optionalNumber,
  LOG_LEVEL: z.string().optional(),
  SERVER_NAME: z.string().min(1).default(DEFAULT_CONFIG.serverName),
  SERVER_VERSION: z.string().min(1).default(DEFAULT_CONFIG.serverVersion),
  ALLOW_INSECURE_HTTP: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((value) => value === "true" || value === "1"),
  API_AUTH_HEADERS: z.string().optional(),
  API_HEADERS: z.string().optional(),
});

type RawEnv = Record<string, string | undefined>;

export function loadConfig(env: RawEnv, cliSource?: string, cliHeaders?: string): BridgeConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new ConfigError(
      first
        ? `Invalid configuration: ${first.message} (${first.path.join(".")})`
        : "Invalid configuration",
    );
  }

  const parsed = result.data;
  const source = cliSource ?? parsed.OPENAPI_SOURCE;
  if (!source) {
    throw new ConfigError("No spec source provided: use the --spec flag or set OPENAPI_SOURCE");
  }
  const headersRaw = cliHeaders ?? parsed.API_HEADERS ?? parsed.API_AUTH_HEADERS;
  return {
    source,
    baseUrlOverride: parsed.API_BASE_URL,
    timeoutMs: parsed.API_TIMEOUT_MS,
    maxTools: parsed.OPENAPI_MAX_TOOLS,
    maxResponseChars: parsed.API_MAX_RESPONSE_CHARS,
    maxDepth: parsed.SANITIZE_MAX_DEPTH,
    maxArrayLength: parsed.SANITIZE_MAX_ARRAY_LENGTH,
    maxStringLength: parsed.SANITIZE_MAX_STRING_LENGTH,
    logLevel: parseLogLevel(parsed.LOG_LEVEL),
    serverName: parsed.SERVER_NAME,
    serverVersion: parsed.SERVER_VERSION,
    allowInsecureHttp: parsed.ALLOW_INSECURE_HTTP,
    headers: headersRaw !== undefined ? parseHeaders(headersRaw) : undefined,
  };
}

function parseHeaders(raw: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError("Invalid API_HEADERS: expected a JSON object of header name/value pairs");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError("Invalid API_HEADERS: expected a JSON object of header name/value pairs");
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    headers[key] = String(value);
  }
  return headers;
}
