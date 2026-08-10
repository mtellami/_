import { parse as parseYaml } from "yaml";
import { SpecParseError } from "../errors.js";
import type {
  HttpMethod,
  JsonSchema,
  OperationParameter,
  OperationRequestBody,
  ParsedOperation,
  ParsedSpec,
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

type OpenApiDocument = Record<string, unknown>;

export function parseOpenApiSpec(text: string, format?: "json" | "yaml"): ParsedSpec {
  const document = parseDocument(text, format);
  assertOpenApiVersion(document);

  const info = (document.info ?? {}) as Record<string, unknown>;
  const title = typeof info.title === "string" ? info.title : "OpenAPI Spec";
  const version = typeof info.version === "string" ? info.version : "unknown";

  const servers = Array.isArray(document.servers) ? (document.servers as unknown[]) : [];
  const baseUrl = firstServerUrl(servers);

  const paths = (document.paths ?? {}) as Record<string, unknown>;
  const usedNames = new Set<string>();
  const operations: ParsedOperation[] = [];

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!isObject(pathItem)) {
      continue;
    }
    const sharedParameters = extractParameters(pathItem.parameters);
    for (const method of HTTP_METHODS) {
      const op = (pathItem as Record<string, unknown>)[method];
      if (!isObject(op)) {
        continue;
      }
      operations.push(
        buildOperation(path, method, op, sharedParameters, document, baseUrl, usedNames),
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
  if (Array.isArray(schema.items)) {
    schema.items = schema.items.map((item) =>
      dereferenceSchemaInternal(item, root, seen, depth + 1),
    );
  } else if (schema.items) {
    schema.items = dereferenceSchemaInternal(schema.items, root, seen, depth + 1);
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
): ParsedOperation {
  const ownParameters = extractParameters(operation.parameters);
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
  };
}

function extractParameters(value: unknown): OperationParameter[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const parameters: OperationParameter[] = [];
  for (const item of value) {
    if (!isObject(item)) {
      continue;
    }
    const name = item.name;
    const location = item.in;
    if (typeof name !== "string" || typeof location !== "string") {
      continue;
    }
    if (!["query", "header", "path", "cookie"].includes(location)) {
      continue;
    }
    const schema = item.schema ?? {};
    parameters.push({
      name,
      in: location as OperationParameter["in"],
      required: item.required === true,
      description: typeof item.description === "string" ? item.description : undefined,
      schema: isObject(schema) ? (schema as JsonSchema) : undefined,
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
  return document;
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

function firstServerUrl(servers: unknown[]): string {
  const first = servers[0];
  if (isObject(first) && typeof first.url === "string") {
    return first.url;
  }
  return "";
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
