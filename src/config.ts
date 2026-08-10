import { z } from "zod";
import { ConfigError } from "./errors.js";
import { parseLogLevel, type LogLevel } from "./logger.js";

export interface BridgeConfig {
  /** Raw spec source: a filesystem path or an http(s) URL. */
  source: string;
  baseUrlOverride?: string;
  timeoutMs: number;
  maxResponseChars: number;
  maxDepth: number;
  maxArrayLength: number;
  maxStringLength: number;
  logLevel: LogLevel;
  serverName: string;
  serverVersion: string;
  allowInsecureHttp: boolean;
}

export const DEFAULT_CONFIG = {
  timeoutMs: 30_000,
  maxResponseChars: 200_000,
  maxDepth: 8,
  maxArrayLength: 100,
  maxStringLength: 2_000,
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

const EnvSchema = z.object({
  OPENAPI_SOURCE: z.string().min(1, "OPENAPI_SOURCE is required"),
  API_BASE_URL: z.string().min(1).optional(),
  API_TIMEOUT_MS: numberOrEmpty(DEFAULT_CONFIG.timeoutMs),
  API_MAX_RESPONSE_CHARS: numberOrEmpty(DEFAULT_CONFIG.maxResponseChars),
  SANITIZE_MAX_DEPTH: numberOrEmpty(DEFAULT_CONFIG.maxDepth),
  SANITIZE_MAX_ARRAY_LENGTH: numberOrEmpty(DEFAULT_CONFIG.maxArrayLength),
  SANITIZE_MAX_STRING_LENGTH: numberOrEmpty(DEFAULT_CONFIG.maxStringLength),
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
  return {
    source: cliSource ?? parsed.OPENAPI_SOURCE,
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
