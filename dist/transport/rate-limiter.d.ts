/**
 * Rate Limiting — Token bucket algorithm for HTTP endpoint protection.
 */
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
export declare class RateLimiter {
    private buckets;
    private cleanupTimer;
    private config;
    constructor(config: RateLimiterConfig);
    /** Try to consume a token for the given key. Returns true if allowed. */
    tryConsume(key: string): boolean;
    /** Check and consume, returning full result with retry info. */
    check(key: string): RateLimitResult;
    /** Get remaining tokens for a key without consuming. */
    getRemainingTokens(key: string): number;
    /** Start periodic cleanup of stale buckets. */
    startCleanup(staleAfterMs?: number, intervalMs?: number): void;
    /** Stop cleanup timer. */
    stopCleanup(): void;
    /** Reset all buckets. */
    reset(): void;
    /** Number of active buckets (for monitoring). */
    get bucketCount(): number;
    private refill;
}
export interface RouteLimitConfig {
    /** Route pattern (exact match or prefix with *) */
    pattern: string;
    /** Rate limiter config for this route */
    config: RateLimiterConfig;
}
export type KeyExtractor = (req: {
    ip?: string;
    principal?: string;
}) => string;
/** Default key extractor: uses IP */
export declare const ipKeyExtractor: KeyExtractor;
/** Principal-based key extractor */
export declare const principalKeyExtractor: KeyExtractor;
/** Combined IP + principal key extractor */
export declare const combinedKeyExtractor: KeyExtractor;
export declare class RateLimitMiddleware {
    private limiters;
    private routes;
    private defaultLimiter;
    private keyExtractor;
    constructor(opts?: {
        routes?: RouteLimitConfig[];
        defaultConfig?: RateLimiterConfig;
        keyExtractor?: KeyExtractor;
    });
    /** Check if a request is allowed. Returns result with retry info. */
    checkRequest(path: string, req: {
        ip?: string;
        principal?: string;
    }): RateLimitResult;
    /** Start cleanup on all limiters. */
    startCleanup(): void;
    /** Stop cleanup on all limiters. */
    stopCleanup(): void;
    private findLimiter;
}
