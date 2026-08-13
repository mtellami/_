import { z } from "zod";
import { ConfigError } from "./errors.js";
import { parseLogLevel, type LogLevel } from "./logger.js";

export interface AuthConfig {
  /** Raw headers injected into every request (e.g. proxy auth). */
  headers?: Record<string, string>;
  /** Value used for `apiKey` security schemes. */
  apiKey?: string;
  /** Value used for `http/bearer`, `oauth2` and `openIdConnect` schemes. */
  bearerToken?: string;
  /** Username used for `http/basic` schemes. */
  username?: string;
  /** Password used for `http/basic` schemes. */
  password?: string;
}

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
  /** Credentials the bridge injects into protected operations. */
  auth?: AuthConfig;
}

export const DEFAULT_CONFIG = {
  timeoutMs: 30_000,
  maxTools: 100,
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
  API_API_KEY: z.string().min(1).optional(),
  API_AUTH_TOKEN: z.string().min(1).optional(),
  API_AUTH_USERNAME: z.string().min(1).optional(),
  API_AUTH_PASSWORD: z.string().min(1).optional(),
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
    maxTools: parsed.OPENAPI_MAX_TOOLS,
    maxResponseChars: parsed.API_MAX_RESPONSE_CHARS,
    maxDepth: parsed.SANITIZE_MAX_DEPTH,
    maxArrayLength: parsed.SANITIZE_MAX_ARRAY_LENGTH,
    maxStringLength: parsed.SANITIZE_MAX_STRING_LENGTH,
    logLevel: parseLogLevel(parsed.LOG_LEVEL),
    serverName: parsed.SERVER_NAME,
    serverVersion: parsed.SERVER_VERSION,
    allowInsecureHttp: parsed.ALLOW_INSECURE_HTTP,
    auth: buildAuthConfig({
      headersRaw: parsed.API_AUTH_HEADERS,
      apiKey: parsed.API_API_KEY,
      bearerToken: parsed.API_AUTH_TOKEN,
      username: parsed.API_AUTH_USERNAME,
      password: parsed.API_AUTH_PASSWORD,
    }),
  };
}

function buildAuthConfig(input: {
  headersRaw?: string;
  apiKey?: string;
  bearerToken?: string;
  username?: string;
  password?: string;
}): AuthConfig | undefined {
  const auth: AuthConfig = {};
  if (input.headersRaw !== undefined) {
    auth.headers = parseAuthHeaders(input.headersRaw);
  }
  if (input.apiKey !== undefined) {
    auth.apiKey = input.apiKey;
  }
  if (input.bearerToken !== undefined) {
    auth.bearerToken = input.bearerToken;
  }
  if (input.username !== undefined) {
    auth.username = input.username;
  }
  if (input.password !== undefined) {
    auth.password = input.password;
  }
  return Object.keys(auth).length > 0 ? auth : undefined;
}

function parseAuthHeaders(raw: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError(
      "Invalid API_AUTH_HEADERS: expected a JSON object of header name/value pairs",
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError(
      "Invalid API_AUTH_HEADERS: expected a JSON object of header name/value pairs",
    );
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    headers[key] = String(value);
  }
  return headers;
}
