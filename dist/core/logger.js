/**
 * Structured Logging Framework
 * Replaces console.log/console.error with structured JSON logging.
 */
// ── Log Levels ──
export var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["DEBUG"] = 0] = "DEBUG";
    LogLevel[LogLevel["INFO"] = 1] = "INFO";
    LogLevel[LogLevel["WARN"] = 2] = "WARN";
    LogLevel[LogLevel["ERROR"] = 3] = "ERROR";
    LogLevel[LogLevel["SILENT"] = 4] = "SILENT";
})(LogLevel || (LogLevel = {}));
// ── Global State ──
let globalLogLevel = LogLevel.INFO;
let logOutput = defaultOutput;
function defaultOutput(entry) {
    const line = JSON.stringify(entry);
    if (entry.level === 'ERROR' || entry.level === 'WARN') {
        process.stderr.write(line + '\n');
    }
    else {
        process.stdout.write(line + '\n');
    }
}
/** Set the global log level. Loggers at a lower level are suppressed. */
export function setGlobalLogLevel(level) {
    globalLogLevel = level;
}
/** Get the current global log level. */
export function getGlobalLogLevel() {
    return globalLogLevel;
}
/** Override the log output function (for testing). */
export function setLogOutput(fn) {
    logOutput = fn;
}
/** Reset to default output. */
export function resetLogOutput() {
    logOutput = defaultOutput;
}
// ── Console Logger ──
const LEVEL_NAMES = {
    [LogLevel.DEBUG]: 'DEBUG',
    [LogLevel.INFO]: 'INFO',
    [LogLevel.WARN]: 'WARN',
    [LogLevel.ERROR]: 'ERROR',
    [LogLevel.SILENT]: 'SILENT',
};
export class ConsoleLogger {
    module;
    level;
    constructor(module, level) {
        this.module = module;
        this.level = level;
    }
    debug(message, context) {
        this.emit(LogLevel.DEBUG, message, context);
    }
    info(message, context) {
        this.emit(LogLevel.INFO, message, context);
    }
    warn(message, context) {
        this.emit(LogLevel.WARN, message, context);
    }
    error(message, context) {
        this.emit(LogLevel.ERROR, message, context);
    }
    emit(level, message, context) {
        const effectiveLevel = this.level ?? globalLogLevel;
        if (level < effectiveLevel)
            return;
        const entry = {
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
export function createLogger(module, level) {
    return new ConsoleLogger(module, level);
}
