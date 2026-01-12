type LogLevel = "debug" | "info" | "warn" | "error";

interface LoggerOptions {
  level?: LogLevel;
  silent?: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private readonly level: number;
  private readonly silent: boolean;

  constructor(options: LoggerOptions = {}) {
    this.level = LOG_LEVELS[options.level || "info"];
    this.silent = options.silent || false;
  }

  private shouldLog(level: LogLevel): boolean {
    return !this.silent && LOG_LEVELS[level] >= this.level;
  }

  private formatMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog("debug")) {
      console.debug(this.formatMessage("debug", message, meta));
    }
  }

  info(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog("info")) {
      console.info(this.formatMessage("info", message, meta));
    }
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog("warn")) {
      console.warn(this.formatMessage("warn", message, meta));
    }
  }

  error(message: string, error?: Error | Record<string, unknown>): void {
    if (this.shouldLog("error")) {
      const meta = error instanceof Error 
        ? { message: error.message, stack: error.stack }
        : error;
      console.error(this.formatMessage("error", message, meta));
    }
  }

  success(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog("info")) {
      console.info(this.formatMessage("info", `✓ ${message}`, meta));
    }
  }

  skip(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog("info")) {
      console.info(this.formatMessage("info", `⊘ ${message}`, meta));
    }
  }

  alert(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog("warn")) {
      console.warn(this.formatMessage("warn", `⚠ ${message}`, meta));
    }
  }
}

const getLogLevel = (): LogLevel => {
  const level = process.env.LOG_LEVEL?.toLowerCase();
  if (level === "debug" || level === "info" || level === "warn" || level === "error") {
    return level;
  }
  return "info";
};

export const logger = new Logger({
  level: getLogLevel(),
  silent: process.env.LOG_SILENT === "true",
});

export const createLogger = (options?: LoggerOptions): Logger => {
  return new Logger(options);
};