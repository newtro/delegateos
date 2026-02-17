/**
 * Rate Limiting — Token bucket algorithm for HTTP endpoint protection.
 */

// ── Types ──

export interface RateLimiterConfig {
  /** Maximum tokens in the bucket */
  maxTokens: number;
  /** Number of tokens to refill per interval */
  refillRate: number;
  /** Refill interval in milliseconds */
  refillIntervalMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remainingTokens: number;
  retryAfterMs?: number;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
  lastAccess: number;
}

// ── Rate Limiter ──

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private config: RateLimiterConfig;

  constructor(config: RateLimiterConfig) {
    this.config = config;
  }

  /** Try to consume a token for the given key. Returns true if allowed. */
  tryConsume(key: string): boolean {
    const result = this.check(key);
    return result.allowed;
  }

  /** Check and consume, returning full result with retry info. */
  check(key: string): RateLimitResult {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { tokens: this.config.maxTokens, lastRefill: now, lastAccess: now };
      this.buckets.set(key, bucket);
    }

    // Refill tokens based on elapsed time
    this.refill(bucket, now);
    bucket.lastAccess = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, remainingTokens: bucket.tokens };
    }

    // Calculate retry-after: time until next token
    const timeSinceRefill = now - bucket.lastRefill;
    const timeToNextRefill = this.config.refillIntervalMs - timeSinceRefill;
    const retryAfterMs = Math.max(0, timeToNextRefill);

    return { allowed: false, remainingTokens: 0, retryAfterMs };
  }

  /** Get remaining tokens for a key without consuming. */
  getRemainingTokens(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket) return this.config.maxTokens;
    this.refill(bucket, Date.now());
    return bucket.tokens;
  }

  /** Start periodic cleanup of stale buckets. */
  startCleanup(staleAfterMs = 300_000, intervalMs = 60_000): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      const cutoff = Date.now() - staleAfterMs;
      for (const [key, bucket] of this.buckets) {
        if (bucket.lastAccess < cutoff) {
          this.buckets.delete(key);
        }
      }
    }, intervalMs);
  }

  /** Stop cleanup timer. */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /** Reset all buckets. */
  reset(): void {
    this.buckets.clear();
  }

  /** Number of active buckets (for monitoring). */
  get bucketCount(): number {
    return this.buckets.size;
  }

  private refill(bucket: Bucket, now: number): void {
    const elapsed = now - bucket.lastRefill;
    const intervals = Math.floor(elapsed / this.config.refillIntervalMs);
    if (intervals > 0) {
      bucket.tokens = Math.min(this.config.maxTokens, bucket.tokens + intervals * this.config.refillRate);
      bucket.lastRefill += intervals * this.config.refillIntervalMs;
    }
  }
}

// ── Route-based Rate Limit Config ──

export interface RouteLimitConfig {
  /** Route pattern (exact match or prefix with *) */
  pattern: string;
  /** Rate limiter config for this route */
  config: RateLimiterConfig;
}

export type KeyExtractor = (req: { ip?: string; principal?: string }) => string;

/** Default key extractor: uses IP */
export const ipKeyExtractor: KeyExtractor = (req) => req.ip ?? 'unknown';

/** Principal-based key extractor */
export const principalKeyExtractor: KeyExtractor = (req) => req.principal ?? req.ip ?? 'unknown';

/** Combined IP + principal key extractor */
export const combinedKeyExtractor: KeyExtractor = (req) =>
  `${req.ip ?? 'unknown'}:${req.principal ?? 'anonymous'}`;

// ── Rate Limit Middleware ──

export class RateLimitMiddleware {
  private limiters = new Map<string, RateLimiter>();
  private routes: RouteLimitConfig[];
  private defaultLimiter: RateLimiter;
  private keyExtractor: KeyExtractor;

  constructor(opts: {
    routes?: RouteLimitConfig[];
    defaultConfig?: RateLimiterConfig;
    keyExtractor?: KeyExtractor;
  } = {}) {
    this.routes = opts.routes ?? [];
    this.keyExtractor = opts.keyExtractor ?? ipKeyExtractor;
    this.defaultLimiter = new RateLimiter(
      opts.defaultConfig ?? { maxTokens: 100, refillRate: 100, refillIntervalMs: 60_000 },
    );

    for (const route of this.routes) {
      this.limiters.set(route.pattern, new RateLimiter(route.config));
    }
  }

  /** Check if a request is allowed. Returns result with retry info. */
  checkRequest(path: string, req: { ip?: string; principal?: string }): RateLimitResult {
    const key = this.keyExtractor(req);
    const limiter = this.findLimiter(path);
    return limiter.check(key);
  }

  /** Start cleanup on all limiters. */
  startCleanup(): void {
    this.defaultLimiter.startCleanup();
    for (const limiter of this.limiters.values()) {
      limiter.startCleanup();
    }
  }

  /** Stop cleanup on all limiters. */
  stopCleanup(): void {
    this.defaultLimiter.stopCleanup();
    for (const limiter of this.limiters.values()) {
      limiter.stopCleanup();
    }
  }

  private findLimiter(path: string): RateLimiter {
    for (const route of this.routes) {
      if (route.pattern.endsWith('*')) {
        if (path.startsWith(route.pattern.slice(0, -1))) {
          return this.limiters.get(route.pattern) ?? this.defaultLimiter;
        }
      } else if (path === route.pattern) {
        return this.limiters.get(route.pattern) ?? this.defaultLimiter;
      }
    }
    return this.defaultLimiter;
  }
}
