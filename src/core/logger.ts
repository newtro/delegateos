/**
 * Structured Logging Framework
 * Replaces console.log/console.error with structured JSON logging.
 */

// ── Log Levels ──

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

// ── Logger Interface ──

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

// ── Structured Log Entry ──

export interface LogEntry {
  timestamp: string;
  level: string;
  module: string;
  message: string;
  context?: Record<string, unknown>;
}

// ── Global State ──

let globalLogLevel: LogLevel = LogLevel.INFO;
let logOutput: (entry: LogEntry) => void = defaultOutput;

function defaultOutput(entry: LogEntry): void {
  const line = JSON.stringify(entry);
  if (entry.level === 'ERROR' || entry.level === 'WARN') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

/** Set the global log level. Loggers at a lower level are suppressed. */
export function setGlobalLogLevel(level: LogLevel): void {
  globalLogLevel = level;
}

/** Get the current global log level. */
export function getGlobalLogLevel(): LogLevel {
  return globalLogLevel;
}

/** Override the log output function (for testing). */
export function setLogOutput(fn: (entry: LogEntry) => void): void {
  logOutput = fn;
}

/** Reset to default output. */
export function resetLogOutput(): void {
  logOutput = defaultOutput;
}

// ── Console Logger ──

const LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.SILENT]: 'SILENT',
};

export class ConsoleLogger implements Logger {
  constructor(
    private module: string,
    private level?: LogLevel,
  ) {}

  debug(message: string, context?: Record<string, unknown>): void {
    this.emit(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.emit(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.emit(LogLevel.WARN, message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.emit(LogLevel.ERROR, message, context);
  }

  private emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const effectiveLevel = this.level ?? globalLogLevel;
    if (level < effectiveLevel) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LEVEL_NAMES[level],
      module: this.module,
      message,
    };
    if (context && Object.keys(context).length > 0) {
      entry.context = context;
    }
    logOutput(entry);
  }
}

/** Create a logger for a given module. */
export function createLogger(module: string, level?: LogLevel): Logger {
  return new ConsoleLogger(module, level);
}
