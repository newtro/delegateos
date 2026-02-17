import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createLogger,
  ConsoleLogger,
  setGlobalLogLevel,
  getGlobalLogLevel,
  setLogOutput,
  resetLogOutput,
  LogLevel,
} from '../src/core/logger.js';
import type { LogEntry } from '../src/core/logger.js';

describe('Structured Logging', () => {
  let captured: LogEntry[];

  beforeEach(() => {
    captured = [];
    setLogOutput((entry) => captured.push(entry));
    setGlobalLogLevel(LogLevel.DEBUG);
  });

  afterEach(() => {
    resetLogOutput();
    setGlobalLogLevel(LogLevel.INFO);
  });

  it('creates a logger with module name', () => {
    const log = createLogger('test-module');
    log.info('hello');
    expect(captured).toHaveLength(1);
    expect(captured[0].module).toBe('test-module');
    expect(captured[0].message).toBe('hello');
    expect(captured[0].level).toBe('INFO');
    expect(captured[0].timestamp).toBeDefined();
  });

  it('logs all levels', () => {
    const log = createLogger('m');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(captured.map(e => e.level)).toEqual(['DEBUG', 'INFO', 'WARN', 'ERROR']);
  });

  it('includes context when provided', () => {
    const log = createLogger('m');
    log.info('with context', { foo: 'bar', count: 42 });
    expect(captured[0].context).toEqual({ foo: 'bar', count: 42 });
  });

  it('omits context when empty', () => {
    const log = createLogger('m');
    log.info('no context');
    expect(captured[0].context).toBeUndefined();
  });

  it('respects global log level', () => {
    setGlobalLogLevel(LogLevel.WARN);
    const log = createLogger('m');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(captured).toHaveLength(2);
    expect(captured.map(e => e.level)).toEqual(['WARN', 'ERROR']);
  });

  it('per-logger level overrides global', () => {
    setGlobalLogLevel(LogLevel.DEBUG);
    const log = createLogger('m', LogLevel.ERROR);
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(captured).toHaveLength(1);
    expect(captured[0].level).toBe('ERROR');
  });

  it('SILENT level suppresses all', () => {
    setGlobalLogLevel(LogLevel.SILENT);
    const log = createLogger('m');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(captured).toHaveLength(0);
  });

  it('getGlobalLogLevel returns current level', () => {
    setGlobalLogLevel(LogLevel.WARN);
    expect(getGlobalLogLevel()).toBe(LogLevel.WARN);
  });

  it('ConsoleLogger is a proper class', () => {
    const log = new ConsoleLogger('cls');
    expect(log).toBeInstanceOf(ConsoleLogger);
    log.info('test');
    expect(captured[0].module).toBe('cls');
  });

  it('timestamp is ISO format', () => {
    const log = createLogger('m');
    log.info('t');
    expect(() => new Date(captured[0].timestamp)).not.toThrow();
    expect(new Date(captured[0].timestamp).toISOString()).toBe(captured[0].timestamp);
  });

  it('empty context object is omitted', () => {
    const log = createLogger('m');
    log.info('empty', {});
    expect(captured[0].context).toBeUndefined();
  });
});
