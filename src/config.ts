import { z } from "zod";
import { ConfigError } from "./errors.js";
import { parseLogLevel, type LogLevel } from "./logger.js";

export interface BridgeConfig {
  /** Raw spec source: a filesystem path or an http(s) URL. */
  source: string;
  baseUrlOverride?: string;
  timeoutMs: number;
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
}

export const DEFAULT_CONFIG = {
  timeoutMs: 30_000,
  serverName: "openapi-mcp-bridge",
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
});

type RawEnv = Record<string, string | undefined>;

export function loadConfig(env: RawEnv, cliSource?: string): BridgeConfig {
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
  return {
    source,
    baseUrlOverride: parsed.API_BASE_URL,
    timeoutMs: parsed.API_TIMEOUT_MS,
    maxResponseChars: parsed.API_MAX_RESPONSE_CHARS,
    maxDepth: parsed.SANITIZE_MAX_DEPTH,
    maxArrayLength: parsed.SANITIZE_MAX_ARRAY_LENGTH,
    maxStringLength: parsed.SANITIZE_MAX_STRING_LENGTH,
    logLevel: parseLogLevel(parsed.LOG_LEVEL),
    serverName: parsed.SERVER_NAME,
    serverVersion: parsed.SERVER_VERSION,
    allowInsecureHttp: parsed.ALLOW_INSECURE_HTTP,
  };
}
