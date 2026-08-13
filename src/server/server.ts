import { McpServer, fromJsonSchema, type JsonSchemaType } from "@modelcontextprotocol/server";
import type { ParsedOperation, ParsedSpec, RuntimeContext } from "../types.js";
import { SpecParseError } from "../errors.js";
import { buildInputSchema } from "../schema/index.js";
import { validateData } from "../validator/index.js";
import { executeOperation } from "../http/index.js";
import { sanitizeResponse } from "../sanitizer/index.js";
import { createToolHandler, healthSchema, type ToolDeps } from "./handler.js";

export interface BridgeContext {
  runtime: RuntimeContext;
  parsedSpec: ParsedSpec;
}

const defaultDeps: ToolDeps = {
  validate: validateData,
  execute: executeOperation,
  sanitize: sanitizeResponse,
};

export function createMcpServer(context: BridgeContext): McpServer {
  const { runtime, parsedSpec } = context;
  const server = new McpServer({
    name: runtime.config.serverName,
    version: runtime.config.serverVersion,
  });

  if (parsedSpec.operations.length > runtime.config.maxTools) {
    const msg = `OpenAPI spec has ${parsedSpec.operations.length} operations, exceeding the maximum supported limit of ${runtime.config.maxTools}. Massive APIs with hundreds of endpoints are not supported yet to prevent LLM context overflow.`;
    runtime.logger.error(msg);
    throw new SpecParseError(msg);
  }

  server.registerTool(
    "health",
    {
      description: "Health check for the OpenAPI bridge server.",
      inputSchema: fromJsonSchema(healthSchema as unknown as JsonSchemaType),
    },
    async (args) => {
      const echo = (args as Record<string, unknown> | undefined)?.echo;
      const text = typeof echo === "string" && echo !== "" ? `ok: ${echo}` : "ok";
      return { content: [{ type: "text", text }] };
    },
  );

  for (const operation of parsedSpec.operations) {
    const inputSchema = buildInputSchema(operation);
    server.registerTool(
      operation.toolName,
      {
        description: describeOperation(operation),
        inputSchema: fromJsonSchema(inputSchema as unknown as JsonSchemaType),
      },
      createToolHandler(operation, inputSchema, runtime, defaultDeps),
    );
  }

  runtime.logger.info(
    `Registered ${parsedSpec.operations.length} tools from "${parsedSpec.title}" v${parsedSpec.version}`,
  );
  return server;
}

function describeOperation(operation: ParsedOperation): string {
  const parts = [
    `HTTP ${operation.method.toUpperCase()} ${operation.path}`,
    operation.summary,
    operation.description,
  ].filter((part): part is string => Boolean(part));
  return parts.join("\n");
}
