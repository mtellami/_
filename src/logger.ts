export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function parseLogLevel(value: string | undefined): LogLevel {
  const candidate = value?.toLowerCase();
  if (candidate && candidate in LEVEL_ORDER) {
    return candidate as LogLevel;
  }
  return "info";
}

export class Logger {
  readonly level: LogLevel;
  readonly prefix: string;

  constructor(options: { level?: LogLevel; prefix?: string } = {}) {
    this.level = options.level ?? "info";
    this.prefix = options.prefix ?? "";
  }

  child(prefix: string): Logger {
    const combined = this.prefix ? `${this.prefix} ${prefix}` : prefix;
    return new Logger({ level: this.level, prefix: combined });
  }

  debug(message: string, ...args: unknown[]): void {
    this.write("debug", message, args);
  }

  info(message: string, ...args: unknown[]): void {
    this.write("info", message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.write("warn", message, args);
  }

  error(message: string, ...args: unknown[]): void {
    this.write("error", message, args);
  }

  private write(level: LogLevel, message: string, args: unknown[]): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) {
      return;
    }
    const stamp = new Date().toISOString();
    const prefix = this.prefix ? ` [${this.prefix}]` : "";
    const line = `${stamp} ${level.toUpperCase()}${prefix} ${message}${
      args.length ? " " + fmt(args) : ""
    }`;
    process.stderr.write(line + "\n");
  }
}

function fmt(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") {
        return arg;
      }
      if (arg instanceof Error) {
        return arg.stack ?? arg.message;
      }
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}
