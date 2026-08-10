#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConfig, type BridgeConfig } from "./config.js";
import { Logger } from "./logger.js";
import { buildContext } from "./pipeline.js";
import { createMcpServer } from "./server/index.js";

interface CliArgs {
  source?: string;
  help: boolean;
}

export function parseCliArgs(argv: string[]): CliArgs {
  let source: string | undefined;
  let help = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--spec" || arg === "-s") {
      const next = argv[i + 1];
      if (next !== undefined) {
        source = next;
      }
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg.startsWith("--")) {
      // ignore unknown flags
    } else if (source === undefined) {
      source = arg;
    }
  }
  return { source, help };
}

const USAGE = `openapi-mcp-bridge — Dynamic OpenAPI-to-MCP Bridge Engine

Usage:
  openapi-mcp-bridge [options] [source]

Options:
  -s, --spec <source>  Path to an OpenAPI spec file, or an http(s):// URL.
                       Overrides the OPENAPI_SOURCE environment variable.
      --help, -h       Show this help message and exit.

Environment:
  OPENAPI_SOURCE       Spec file path or URL (required unless --spec is given).
  API_BASE_URL         Override the base URL used for every request.
  API_TIMEOUT_MS       Per-request timeout in ms (default: 30000).
  API_MAX_RESPONSE_CHARS  Response character budget (default: unlimited).
  SANITIZE_MAX_DEPTH   Max JSON depth kept (default: unlimited).
  SANITIZE_MAX_ARRAY_LENGTH  Max array elements kept (default: unlimited).
  SANITIZE_MAX_STRING_LENGTH Max string length kept (default: unlimited).
  LOG_LEVEL            debug | info | warn | error (default: info).
  SERVER_NAME          MCP server name (default: openapi-mcp-bridge).
  SERVER_VERSION       MCP server version (default: 0.1.0).
  ALLOW_INSECURE_HTTP  "true" to allow plain http:// targets (default: false).
`;

export async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  if (cli.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  let config: BridgeConfig;
  try {
    config = loadConfig(process.env, cli.source);
  } catch (err) {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.stderr.write(USAGE);
    process.exit(1);
  }

  const logger = new Logger({ level: config.logLevel });
  logger.info(`OpenAPI Bridge starting (server="${config.serverName}" v${config.serverVersion})`);

  const handle = serveStdio(async () => {
    const context = await buildContext(config, logger);
    return createMcpServer(context);
  });

  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}, shutting down`);
    void handle.close().then(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
