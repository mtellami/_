import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./config.js";
import { Logger } from "./logger.js";
import { buildContext } from "./pipeline.js";
import { createMcpServer } from "./server/index.js";

interface CliArgs {
  source?: string;
}

export function parseCliArgs(argv: string[]): CliArgs {
  let source: string | undefined;
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
    } else if (arg.startsWith("--")) {
      // ignore unknown flags
    } else if (source === undefined) {
      source = arg;
    }
  }
  return { source };
}

export async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  const config = loadConfig(process.env, cli.source);
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
