import type { CallToolResult } from "@modelcontextprotocol/server";
import { HttpExecutionError, ValidationError } from "../errors.js";
import type { HttpResult, JsonSchema, ParsedOperation, RuntimeContext } from "../types.js";
import type { ValidationOutcome } from "../validator/index.js";
import type { SanitizeOptions, SanitizeResult } from "../sanitizer/index.js";

export const healthSchema: JsonSchema = {
  type: "object",
  properties: {
    echo: { type: "string" },
  },
  additionalProperties: false,
};

export interface ToolDeps {
  validate: (schema: JsonSchema, value: unknown) => ValidationOutcome;
  execute: (
    runtime: RuntimeContext,
    operation: ParsedOperation,
    args: Record<string, unknown>,
  ) => Promise<HttpResult>;
  sanitize: (text: string, options: SanitizeOptions) => SanitizeResult;
}

export function createToolHandler(
  operation: ParsedOperation,
  inputSchema: JsonSchema,
  runtime: RuntimeContext,
  deps: ToolDeps,
): (args: unknown) => Promise<CallToolResult> {
  return async (args: unknown): Promise<CallToolResult> => {
    const input = (args ?? {}) as Record<string, unknown>;
    const outcome = deps.validate(inputSchema, input);
    if (!outcome.ok) {
      const text = `Input validation error: Invalid arguments for tool ${operation.toolName}:\n${outcome.errors.join("\n")}`;
      return { content: [{ type: "text", text }], isError: true };
    }

    try {
      const http = await deps.execute(runtime, operation, input);
      const sanitized = deps.sanitize(http.bodyText, {
        maxChars: runtime.config.maxResponseChars,
        maxDepth: runtime.config.maxDepth,
        maxArrayLength: runtime.config.maxArrayLength,
        maxStringLength: runtime.config.maxStringLength,
      });
      const content = [
        `HTTP ${http.status} ${http.statusText}`,
        sanitized.text,
        sanitized.truncated ? "[response truncated]" : "",
      ]
        .filter(Boolean)
        .join("\n");
      runtime.logger.debug(`Tool ${operation.toolName} returned HTTP ${http.status}`, {
        url: http.url,
        truncated: sanitized.truncated,
      });
      return { content: [{ type: "text", text: content }], isError: false };
    } catch (err) {
      if (err instanceof HttpExecutionError) {
        return textResult(`Execution error for tool ${operation.toolName}: ${err.message}`, true);
      }
      if (err instanceof ValidationError) {
        return textResult(`Invalid arguments for tool ${operation.toolName}: ${err.message}`, true);
      }
      runtime.logger.error(`Tool ${operation.toolName} failed`, err);
      return textResult(`Unexpected error in tool ${operation.toolName}: ${messageOf(err)}`, true);
    }
  };
}

function textResult(text: string, isError: boolean): CallToolResult {
  return { content: [{ type: "text", text }], isError };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
