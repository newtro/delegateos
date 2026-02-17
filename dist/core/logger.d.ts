/**
 * Structured Logging Framework
 * Replaces console.log/console.error with structured JSON logging.
 */
export declare enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    SILENT = 4
}
export interface Logger {
    debug(message: string, context?: Record<string, unknown>): void;
    info(message: string, context?: Record<string, unknown>): void;
    warn(message: string, context?: Record<string, unknown>): void;
    error(message: string, context?: Record<string, unknown>): void;
}
export interface LogEntry {
    timestamp: string;
    level: string;
    module: string;
    message: string;
    context?: Record<string, unknown>;
}
/** Set the global log level. Loggers at a lower level are suppressed. */
export declare function setGlobalLogLevel(level: LogLevel): void;
/** Get the current global log level. */
export declare function getGlobalLogLevel(): LogLevel;
/** Override the log output function (for testing). */
export declare function setLogOutput(fn: (entry: LogEntry) => void): void;
/** Reset to default output. */
export declare function resetLogOutput(): void;
export declare class ConsoleLogger implements Logger {
    private module;
    private level?;
    constructor(module: string, level?: LogLevel | undefined);
    debug(message: string, context?: Record<string, unknown>): void;
    info(message: string, context?: Record<string, unknown>): void;
    warn(message: string, context?: Record<string, unknown>): void;
    error(message: string, context?: Record<string, unknown>): void;
    private emit;
}
/** Create a logger for a given module. */
export declare function createLogger(module: string, level?: LogLevel): Logger;
