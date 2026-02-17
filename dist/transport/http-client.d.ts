/**
 * MCP HTTP Client — connects to MCPHttpServer instances.
 */
import type { SerializedDCT } from '../core/types.js';
import { CircuitBreaker, type CircuitBreakerConfig } from '../core/circuit-breaker.js';
export interface RetryConfig {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
}
/**
 * Client for connecting to MCP HTTP servers.
 */
export declare class MCPHttpClient {
    private baseUrl;
    private dct?;
    private retryConfig;
    private idCounter;
    private circuitBreaker;
    private logger;
    constructor(baseUrl: string, dct?: SerializedDCT | undefined, retryConfig?: Partial<RetryConfig>, circuitBreakerConfig?: CircuitBreakerConfig);
    /** Get the circuit breaker for inspection/testing. */
    getCircuitBreaker(): CircuitBreaker;
    /**
     * Standard request/response MCP call.
     */
    call(method: string, params: unknown): Promise<unknown>;
    /**
     * SSE streaming call — yields events as they arrive.
     */
    stream(method: string, params: unknown): AsyncGenerator<unknown>;
    /**
     * Health check.
     */
    healthCheck(): Promise<{
        status: string;
        version: string;
    }>;
    private postWithRetry;
}
