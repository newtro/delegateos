import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RateLimiter, RateLimitMiddleware, ipKeyExtractor, principalKeyExtractor, combinedKeyExtractor } from '../src/transport/rate-limiter.js';

describe('RateLimiter', () => {
  it('allows requests within token budget', () => {
    const rl = new RateLimiter({ maxTokens: 5, refillRate: 1, refillIntervalMs: 1000 });
    for (let i = 0; i < 5; i++) {
      expect(rl.tryConsume('key')).toBe(true);
    }
  });

  it('rejects when tokens exhausted', () => {
    const rl = new RateLimiter({ maxTokens: 2, refillRate: 1, refillIntervalMs: 60000 });
    expect(rl.tryConsume('key')).toBe(true);
    expect(rl.tryConsume('key')).toBe(true);
    expect(rl.tryConsume('key')).toBe(false);
  });

  it('returns remaining tokens', () => {
    const rl = new RateLimiter({ maxTokens: 3, refillRate: 1, refillIntervalMs: 1000 });
    expect(rl.getRemainingTokens('key')).toBe(3);
    rl.tryConsume('key');
    expect(rl.getRemainingTokens('key')).toBe(2);
  });

  it('check() returns retryAfterMs when limited', () => {
    const rl = new RateLimiter({ maxTokens: 1, refillRate: 1, refillIntervalMs: 5000 });
    rl.tryConsume('key');
    const result = rl.check('key');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeDefined();
    expect(result.retryAfterMs!).toBeGreaterThanOrEqual(0);
  });

  it('separate keys have separate buckets', () => {
    const rl = new RateLimiter({ maxTokens: 1, refillRate: 1, refillIntervalMs: 60000 });
    expect(rl.tryConsume('a')).toBe(true);
    expect(rl.tryConsume('a')).toBe(false);
    expect(rl.tryConsume('b')).toBe(true);
  });

  it('refills tokens over time', async () => {
    const rl = new RateLimiter({ maxTokens: 2, refillRate: 2, refillIntervalMs: 50 });
    rl.tryConsume('key');
    rl.tryConsume('key');
    expect(rl.tryConsume('key')).toBe(false);
    await new Promise(r => setTimeout(r, 60));
    expect(rl.tryConsume('key')).toBe(true);
  });

  it('reset clears all buckets', () => {
    const rl = new RateLimiter({ maxTokens: 1, refillRate: 1, refillIntervalMs: 60000 });
    rl.tryConsume('key');
    expect(rl.tryConsume('key')).toBe(false);
    rl.reset();
    expect(rl.tryConsume('key')).toBe(true);
  });

  it('bucketCount tracks active keys', () => {
    const rl = new RateLimiter({ maxTokens: 10, refillRate: 1, refillIntervalMs: 1000 });
    expect(rl.bucketCount).toBe(0);
    rl.tryConsume('a');
    rl.tryConsume('b');
    expect(rl.bucketCount).toBe(2);
  });

  it('does not exceed maxTokens on refill', async () => {
    const rl = new RateLimiter({ maxTokens: 3, refillRate: 10, refillIntervalMs: 10 });
    await new Promise(r => setTimeout(r, 50));
    expect(rl.getRemainingTokens('key')).toBe(3);
  });
});

describe('RateLimitMiddleware', () => {
  it('uses default config when no routes match', () => {
    const mw = new RateLimitMiddleware({
      defaultConfig: { maxTokens: 2, refillRate: 1, refillIntervalMs: 60000 },
    });
    expect(mw.checkRequest('/foo', { ip: '1.2.3.4' }).allowed).toBe(true);
    expect(mw.checkRequest('/foo', { ip: '1.2.3.4' }).allowed).toBe(true);
    expect(mw.checkRequest('/foo', { ip: '1.2.3.4' }).allowed).toBe(false);
  });

  it('matches exact route patterns', () => {
    const mw = new RateLimitMiddleware({
      routes: [
        { pattern: '/health', config: { maxTokens: 100, refillRate: 100, refillIntervalMs: 1000 } },
        { pattern: '/mcp/message', config: { maxTokens: 1, refillRate: 1, refillIntervalMs: 60000 } },
      ],
      defaultConfig: { maxTokens: 50, refillRate: 50, refillIntervalMs: 1000 },
    });
    // /mcp/message has limit of 1
    expect(mw.checkRequest('/mcp/message', { ip: '1.1.1.1' }).allowed).toBe(true);
    expect(mw.checkRequest('/mcp/message', { ip: '1.1.1.1' }).allowed).toBe(false);
    // /health has limit of 100
    expect(mw.checkRequest('/health', { ip: '1.1.1.1' }).allowed).toBe(true);
  });

  it('matches prefix patterns with wildcard', () => {
    const mw = new RateLimitMiddleware({
      routes: [
        { pattern: '/api/*', config: { maxTokens: 1, refillRate: 1, refillIntervalMs: 60000 } },
      ],
    });
    expect(mw.checkRequest('/api/foo', { ip: 'x' }).allowed).toBe(true);
    expect(mw.checkRequest('/api/foo', { ip: 'x' }).allowed).toBe(false);
  });
});

describe('Key Extractors', () => {
  it('ipKeyExtractor uses IP', () => {
    expect(ipKeyExtractor({ ip: '1.2.3.4' })).toBe('1.2.3.4');
    expect(ipKeyExtractor({})).toBe('unknown');
  });

  it('principalKeyExtractor prefers principal', () => {
    expect(principalKeyExtractor({ principal: 'alice', ip: '1.2.3.4' })).toBe('alice');
    expect(principalKeyExtractor({ ip: '1.2.3.4' })).toBe('1.2.3.4');
  });

  it('combinedKeyExtractor combines both', () => {
    expect(combinedKeyExtractor({ ip: '1.2.3.4', principal: 'alice' })).toBe('1.2.3.4:alice');
    expect(combinedKeyExtractor({})).toBe('unknown:anonymous');
  });
});
