export class BridgeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ConfigError extends BridgeError {}

export class SpecLoadError extends BridgeError {}

export class SpecParseError extends BridgeError {}

export class ValidationError extends BridgeError {
  readonly details?: unknown[];

  constructor(message: string, details?: unknown[]) {
    super(message);
    this.details = details;
  }
}

export class HttpExecutionError extends BridgeError {}
