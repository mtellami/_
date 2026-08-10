import type { BridgeConfig } from "./config.js";
import type { Logger } from "./logger.js";

export type HttpMethod = "get" | "post" | "put" | "delete" | "patch" | "head" | "options" | "trace";

export type ParameterLocation = "query" | "header" | "path" | "cookie";

export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema | JsonSchema[];
  required?: string[];
  enum?: unknown[];
  nullable?: boolean;
  additionalProperties?: boolean | JsonSchema;
  format?: string;
  description?: string;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  definitions?: Record<string, JsonSchema>;
  allOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number | boolean;
  exclusiveMaximum?: number | boolean;
  [key: string]: unknown;
}

export interface OperationParameter {
  name: string;
  in: ParameterLocation;
  required: boolean;
  description?: string;
  schema?: JsonSchema;
}

export interface OperationRequestBody {
  required: boolean;
  contentType: string;
  schema?: JsonSchema;
}

export interface ParsedOperation {
  toolName: string;
  method: HttpMethod;
  path: string;
  summary?: string;
  description?: string;
  parameters: OperationParameter[];
  requestBody?: OperationRequestBody;
  baseUrl: string;
}

export interface ParsedSpec {
  title: string;
  version: string;
  operations: ParsedOperation[];
}

export interface RuntimeContext {
  config: BridgeConfig;
  logger: Logger;
  fetchImpl: typeof fetch;
}

export interface HttpRequestContext {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
}

export interface HttpResult {
  url: string;
  method: HttpMethod;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText: string;
}
