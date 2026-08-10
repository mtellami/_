import type { BridgeConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { loadSpec } from "./loader/index.js";
import { parseOpenApiSpec } from "./parser/index.js";
import type { RuntimeContext } from "./types.js";
import type { BridgeContext } from "./server/index.js";

export async function buildContext(
  config: BridgeConfig,
  logger: Logger,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<BridgeContext> {
  logger.info(`Loading OpenAPI spec from "${config.source}"`);
  const loaded = await loadSpec(config.source, {
    timeoutMs: config.timeoutMs,
    fetchImpl,
  });
  logger.debug(`Parsing ${loaded.format} spec (${loaded.text.length} characters)`);
  const parsedSpec = parseOpenApiSpec(loaded.text, loaded.format);

  const runtime: RuntimeContext = {
    config,
    logger,
    fetchImpl,
  };

  return { runtime, parsedSpec };
}
