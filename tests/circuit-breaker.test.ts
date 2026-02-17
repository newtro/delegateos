import { describe, it, expect, beforeEach } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from '../src/core/circuit-breaker.js';
import type { CircuitState } from '../src/core/circuit-breaker.js';

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 100,
      halfOpenMaxAttempts: 2,
    });
  });

  it('starts in CLOSED state', () => {
    expect(cb.getState()).toBe('CLOSED');
  });

  it('executes successfully in CLOSED state', async () => {
    const result = await cb.execute(async () => 42);
    expect(result).toBe(42);
    expect(cb.getState()).toBe('CLOSED');
  });

  it('trips to OPEN after failure threshold', async () => {
    const fail = () => cb.execute(async () => { throw new Error('fail'); });
    await expect(fail()).rejects.toThrow('fail');
    await expect(fail()).rejects.toThrow('fail');
    await expect(fail()).rejects.toThrow('fail');
    expect(cb.getState()).toBe('OPEN');
  });

  it('rejects immediately when OPEN', async () => {
    // Trip it
    for (let i = 0; i < 3; i++) {
      await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
    }
    await expect(cb.execute(async () => 42)).rejects.toThrow(CircuitOpenError);
  });

  it('transitions to HALF_OPEN after reset timeout', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
    }
    expect(cb.getState()).toBe('OPEN');
    await new Promise(r => setTimeout(r, 120));
    expect(cb.getState()).toBe('HALF_OPEN');
  });

  it('recovers from HALF_OPEN on success', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
    }
    await new Promise(r => setTimeout(r, 120));
    const result = await cb.execute(async () => 'recovered');
    expect(result).toBe('recovered');
    expect(cb.getState()).toBe('CLOSED');
  });

  it('trips back to OPEN from HALF_OPEN on failure', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
    }
    await new Promise(r => setTimeout(r, 120));
    await cb.execute(async () => { throw new Error('still failing'); }).catch(() => {});
    expect(cb.getState()).toBe('OPEN');
  });

  it('tracks failure count', async () => {
    expect(cb.getFailureCount()).toBe(0);
    await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
    expect(cb.getFailureCount()).toBe(1);
  });

  it('resets failure count on success', async () => {
    await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
    await cb.execute(async () => 'ok');
    expect(cb.getFailureCount()).toBe(0);
  });

  it('notifies state change listeners', async () => {
    const transitions: [CircuitState, CircuitState][] = [];
    cb.onStateChange((from, to) => transitions.push([from, to]));

    for (let i = 0; i < 3; i++) {
      await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
    }
    expect(transitions).toContainEqual(['CLOSED', 'OPEN']);
  });

  it('forceReset resets to CLOSED', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
    }
    expect(cb.getState()).toBe('OPEN');
    cb.forceReset();
    expect(cb.getState()).toBe('CLOSED');
    expect(cb.getFailureCount()).toBe(0);
  });

  it('CircuitOpenError has correct name', () => {
    const err = new CircuitOpenError('test');
    expect(err.name).toBe('CircuitOpenError');
    expect(err.message).toBe('test');
    expect(err).toBeInstanceOf(Error);
  });

  it('handles async functions that return promises', async () => {
    const result = await cb.execute(() => Promise.resolve('async-result'));
    expect(result).toBe('async-result');
  });
});
