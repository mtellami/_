import { parse as parseYaml } from "yaml";
import type { OpenAPIV3, OpenAPIV3_1 } from "openapi-types";
import { SpecParseError } from "../errors.js";
import type {
  HttpMethod,
  JsonSchema,
  OperationParameter,
  OperationRequestBody,
  ParsedOperation,
  ParsedSpec,
  SecurityScheme,
} from "../types.js";

const HTTP_METHODS: HttpMethod[] = [
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "head",
  "options",
  "trace",
];

const MAX_DEREF_DEPTH = 30;

type OpenApiDocument = (OpenAPIV3.Document | OpenAPIV3_1.Document) & Record<string, unknown>;

export interface ParseOptions {
  /** Origin (e.g. `https://api.example.com`) used to resolve relative server URLs. */
  specOrigin?: string;
}

export function parseOpenApiSpec(
  text: string,
  format?: "json" | "yaml",
  options: ParseOptions = {},
): ParsedSpec {
  const document = parseDocument(text, format);
  assertOpenApiVersion(document);

  const info = (document.info ?? {}) as Record<string, unknown>;
  const title = typeof info.title === "string" ? info.title : "OpenAPI Spec";
  const version = typeof info.version === "string" ? info.version : "unknown";

  const servers = Array.isArray(document.servers) ? (document.servers as unknown[]) : [];
  const baseUrl = firstServerUrl(servers, options.specOrigin);

  const paths = (document.paths ?? {}) as Record<string, unknown>;
  const usedNames = new Set<string>();
  const operations: ParsedOperation[] = [];
  const securitySchemes = extractSecuritySchemes(document);

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!isObject(pathItem)) {
      continue;
    }
    const sharedParameters = extractParameters(pathItem.parameters, document);
    const pathItemSecurity = Array.isArray(pathItem.security) ? pathItem.security : undefined;
    for (const method of HTTP_METHODS) {
      const op = (pathItem as Record<string, unknown>)[method];
      if (!isObject(op)) {
        continue;
      }
      const security = resolveSecurity(
        op.security,
        pathItemSecurity,
        document.security,
        securitySchemes,
      );
      operations.push(
        buildOperation(path, method, op, sharedParameters, document, baseUrl, usedNames, security),
      );
    }
  }

  validateComponentSchemas(document);

  return { title, version, operations };
}

function validateComponentSchemas(document: OpenApiDocument): void {
  const components = isObject(document.components) ? document.components : {};
  const schemas = isObject(components.schemas)
    ? (components.schemas as Record<string, unknown>)
    : {};
  for (const schema of Object.values(schemas)) {
    if (isObject(schema)) {
      dereferenceSchemaInternal(schema as JsonSchema, document, new Set(), 0);
    }
  }
}

export function toToolName(raw: string): string {
  const camelSplit = raw.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const words = camelSplit
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) {
    return "operation";
  }
  const first = words[0]!.toLowerCase();
  const rest = words
    .slice(1)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
  return first + rest.join("");
}

export function uniqueToolName(base: string, used: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

export function dereferenceSchema(schema: JsonSchema, root: OpenApiDocument): JsonSchema {
  return dereferenceSchemaInternal(schema, root, new Set(), 0);
}

function dereferenceSchemaInternal(
  schema: JsonSchema,
  root: OpenApiDocument,
  seen: Set<string>,
  depth: number,
): JsonSchema {
  if (depth > MAX_DEREF_DEPTH) {
    throw new SpecParseError(`Max $ref dereference depth (${MAX_DEREF_DEPTH}) exceeded`);
  }

  if (typeof schema.$ref === "string") {
    const ref = schema.$ref;
    if (seen.has(ref)) {
      throw new SpecParseError(`Circular $ref detected: ${ref}`);
    }
    const target = resolveLocalRef(root, ref);
    if (!target) {
      throw new SpecParseError(`Could not resolve $ref: ${ref}`);
    }
    const nextSeen = new Set(seen);
    nextSeen.add(ref);
    const resolved = dereferenceSchemaInternal(target, root, nextSeen, depth + 1);
    return { ...resolved, description: schema.description ?? resolved.description };
  }

  if (schema.properties) {
    for (const [key, value] of Object.entries(schema.properties)) {
      schema.properties[key] = dereferenceSchemaInternal(value, root, seen, depth + 1);
    }
  }
  for (const keyword of ["items", "prefixItems"] as const) {
    if (Array.isArray(schema[keyword])) {
      schema[keyword] = schema[keyword].map((item) =>
        dereferenceSchemaInternal(item as JsonSchema, root, seen, depth + 1),
      );
    } else if (isObject(schema[keyword])) {
      schema[keyword] = dereferenceSchemaInternal(
        schema[keyword] as JsonSchema,
        root,
        seen,
        depth + 1,
      );
    }
  }
  for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
    if (Array.isArray(schema[keyword])) {
      schema[keyword] = schema[keyword].map((sub) =>
        dereferenceSchemaInternal(sub, root, seen, depth + 1),
      );
    }
  }
  for (const keyword of ["$defs", "definitions"] as const) {
    const defs = schema[keyword];
    if (isObject(defs)) {
      for (const [key, value] of Object.entries(defs)) {
        defs[key] = dereferenceSchemaInternal(value as JsonSchema, root, seen, depth + 1);
      }
    }
  }
  for (const keyword of ["patternProperties"] as const) {
    const map = schema[keyword];
    if (isObject(map)) {
      for (const [key, value] of Object.entries(map)) {
        map[key] = dereferenceSchemaInternal(value as JsonSchema, root, seen, depth + 1);
      }
    }
  }
  for (const keyword of [
    "additionalProperties",
    "additionalItems",
    "unevaluatedProperties",
    "unevaluatedItems",
    "propertyNames",
    "contains",
    "not",
    "if",
    "then",
    "else",
  ] as const) {
    if (isObject(schema[keyword])) {
      schema[keyword] = dereferenceSchemaInternal(
        schema[keyword] as JsonSchema,
        root,
        seen,
        depth + 1,
      );
    }
  }

  return schema;
}

function resolveLocalRef(root: OpenApiDocument, ref: string): JsonSchema | undefined {
  if (!ref.startsWith("#/")) {
    return undefined;
  }
  const segments = ref
    .slice(2)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
  let current: unknown = root;
  for (const segment of segments) {
    if (!isObject(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return isObject(current) ? (current as JsonSchema) : undefined;
}

function buildOperation(
  path: string,
  method: HttpMethod,
  operation: Record<string, unknown>,
  sharedParameters: OperationParameter[],
  root: OpenApiDocument,
  baseUrl: string,
  usedNames: Set<string>,
  security: SecurityScheme[],
): ParsedOperation {
  const ownParameters = extractParameters(operation.parameters, root);
  const merged = mergeParameters(sharedParameters, ownParameters);

  const summary = typeof operation.summary === "string" ? operation.summary : undefined;
  const description = typeof operation.description === "string" ? operation.description : undefined;

  const requestBody = extractRequestBody(operation.requestBody, root);

  const operationId =
    typeof operation.operationId === "string" && operation.operationId.trim() !== ""
      ? operation.operationId
      : `${method}_${path}`;
  const toolName = uniqueToolName(toToolName(operationId), usedNames);

  return {
    toolName,
    method,
    path,
    summary,
    description,
    parameters: merged,
    requestBody,
    baseUrl,
    security,
  };
}

function extractParameters(value: unknown, root: OpenApiDocument): OperationParameter[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const parameters: OperationParameter[] = [];
  for (const item of value) {
    let resolved = item;
    if (isObject(item) && typeof item.$ref === "string") {
      const target = resolveLocalRef(root, item.$ref);
      if (!target) {
        continue;
      }
      resolved = target;
    }
    if (!isObject(resolved)) {
      continue;
    }
    const name = resolved.name;
    const location = resolved.in;
    if (typeof name !== "string" || typeof location !== "string") {
      continue;
    }
    if (!["query", "header", "path", "cookie"].includes(location)) {
      continue;
    }
    const rawSchema = isObject(resolved.schema) ? (resolved.schema as JsonSchema) : undefined;
    parameters.push({
      name,
      in: location as OperationParameter["in"],
      required: resolved.required === true,
      description: typeof resolved.description === "string" ? resolved.description : undefined,
      schema: rawSchema ? dereferenceSchema(rawSchema, root) : undefined,
    });
  }
  return parameters;
}

function mergeParameters(
  shared: OperationParameter[],
  own: OperationParameter[],
): OperationParameter[] {
  const byKey = new Map<string, OperationParameter>();
  for (const parameter of [...shared, ...own]) {
    byKey.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  return [...byKey.values()];
}

function extractRequestBody(
  value: unknown,
  root: OpenApiDocument,
): OperationRequestBody | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  const content = isObject(value.content) ? (value.content as Record<string, unknown>) : {};
  const contentType = Object.keys(content)[0];
  if (!contentType) {
    return undefined;
  }
  const mediaType = isObject(content[contentType])
    ? (content[contentType] as Record<string, unknown>)
    : {};
  const rawSchema = isObject(mediaType.schema) ? (mediaType.schema as JsonSchema) : undefined;
  return {
    required: value.required === true,
    contentType,
    schema: rawSchema ? dereferenceSchema(rawSchema, root) : undefined,
  };
}

function extractSecuritySchemes(document: OpenApiDocument): Map<string, SecurityScheme> {
  const components = isObject(document.components) ? document.components : {};
  const raw = isObject(components.securitySchemes)
    ? (components.securitySchemes as Record<string, unknown>)
    : {};
  const schemes = new Map<string, SecurityScheme>();
  const seen = new Set<string>();
  for (const [name, value] of Object.entries(raw)) {
    const scheme = parseSecurityScheme(value, document, seen, name);
    if (scheme) {
      schemes.set(name, scheme);
    }
  }
  return schemes;
}

function parseSecurityScheme(
  value: unknown,
  root: OpenApiDocument,
  seen: Set<string>,
  name: string,
): SecurityScheme | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  if (typeof value.$ref === "string") {
    if (seen.has(name)) {
      return undefined;
    }
    const target = resolveLocalRef(root, value.$ref);
    if (!target) {
      return undefined;
    }
    const nextSeen = new Set(seen);
    nextSeen.add(name);
    return parseSecurityScheme(target, root, nextSeen, value.$ref);
  }
  const type = value.type;
  if (type === "apiKey") {
    const location = value.in;
    const keyName = value.name;
    if (
      typeof keyName === "string" &&
      (location === "header" || location === "query" || location === "cookie")
    ) {
      return { type: "apiKey", name: keyName, in: location };
    }
    return undefined;
  }
  if (type === "http") {
    return { type: "http", scheme: typeof value.scheme === "string" ? value.scheme : "" };
  }
  if (type === "oauth2") {
    return { type: "oauth2" };
  }
  if (type === "openIdConnect") {
    return { type: "openIdConnect" };
  }
  return undefined;
}

function resolveSecurity(
  operationSecurity: unknown,
  pathItemSecurity: unknown,
  globalSecurity: unknown,
  schemes: Map<string, SecurityScheme>,
): SecurityScheme[] {
  const raw = Array.isArray(operationSecurity)
    ? operationSecurity
    : Array.isArray(pathItemSecurity)
      ? pathItemSecurity
      : Array.isArray(globalSecurity)
        ? globalSecurity
        : [];
  const resolved: SecurityScheme[] = [];
  for (const requirement of raw) {
    if (!isObject(requirement)) {
      continue;
    }
    for (const name of Object.keys(requirement)) {
      const scheme = schemes.get(name);
      if (scheme && !resolved.includes(scheme)) {
        resolved.push(scheme);
      }
    }
  }
  return resolved;
}

function parseDocument(text: string, format?: "json" | "yaml"): OpenApiDocument {
  let document: unknown;
  if (format === "json") {
    document = tryJson(text);
    if (document === undefined) {
      throw new SpecParseError("Failed to parse spec as JSON");
    }
  } else if (format === "yaml") {
    try {
      document = parseYaml(text);
    } catch (err) {
      throw new SpecParseError(`Failed to parse spec as YAML: ${errMessage(err)}`);
    }
  } else {
    document = tryJson(text);
    if (document === undefined) {
      try {
        document = parseYaml(text);
      } catch (err) {
        throw new SpecParseError(`Failed to parse spec: ${errMessage(err)}`);
      }
    }
  }

  if (!isObject(document)) {
    throw new SpecParseError("Spec root must be an object");
  }
  return document as OpenApiDocument;
}

function assertOpenApiVersion(document: OpenApiDocument): void {
  const version = document.openapi;
  if (typeof version !== "string") {
    throw new SpecParseError("Spec is missing the required `openapi` field");
  }
  if (!/^3\.(0|1)(\.\d+)?/.test(version)) {
    throw new SpecParseError(`Unsupported OpenAPI version "${version}": expected 3.0.x or 3.1.x`);
  }
}

function firstServerUrl(servers: unknown[], specOrigin?: string): string {
  const first = servers[0];
  if (!isObject(first) || typeof first.url !== "string" || first.url === "") {
    return "";
  }
  if (/^https?:\/\//i.test(first.url)) {
    return first.url;
  }
  if (specOrigin) {
    try {
      return new URL(first.url, specOrigin).toString();
    } catch {
      return first.url;
    }
  }
  return first.url;
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
