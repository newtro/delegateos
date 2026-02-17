/**
 * MCP HTTP Client — connects to MCPHttpServer instances.
 */

import type { SerializedDCT } from '../core/types.js';
import type { TransportMessage, TransportResponse, SSEEvent } from './types.js';
import { SSEReader } from './sse.js';
import { CircuitBreaker, type CircuitBreakerConfig } from '../core/circuit-breaker.js';
import { createLogger } from '../core/logger.js';
import { globalMetrics } from '../core/metrics.js';

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY: RetryConfig = { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 5000 };

/**
 * Client for connecting to MCP HTTP servers.
 */
export class MCPHttpClient {
  private retryConfig: RetryConfig;
  private idCounter = 0;
  private circuitBreaker: CircuitBreaker;
  private logger = createLogger('MCPHttpClient');

  constructor(
    private baseUrl: string,
    private dct?: SerializedDCT,
    retryConfig?: Partial<RetryConfig>,
    circuitBreakerConfig?: CircuitBreakerConfig,
  ) {
    this.retryConfig = { ...DEFAULT_RETRY, ...retryConfig };
    this.circuitBreaker = new CircuitBreaker(
      circuitBreakerConfig ?? { failureThreshold: 5, resetTimeoutMs: 30_000, halfOpenMaxAttempts: 2 },
    );
  }

  /** Get the circuit breaker for inspection/testing. */
  getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  /**
   * Standard request/response MCP call.
   */
  async call(method: string, params: unknown): Promise<unknown> {
    return this.circuitBreaker.execute(async () => {
      const id = String(++this.idCounter);
      const msg: TransportMessage = { id, method, params };

      const resp = await this.postWithRetry('/mcp/message', msg);
      const body = (await resp.json()) as TransportResponse;

      if (body.error) {
        throw new Error(`MCP error ${body.error.code}: ${body.error.message}`);
      }
      globalMetrics.counter('client.calls', { method });
      return body.result;
    });
  }

  /**
   * SSE streaming call — yields events as they arrive.
   */
  async *stream(method: string, params: unknown): AsyncGenerator<unknown> {
    const id = String(++this.idCounter);
    const msg: TransportMessage = { id, method, params };

    // Initiate stream
    const initResp = await this.postWithRetry('/mcp/stream', msg);
    const initBody = (await initResp.json()) as TransportResponse & { sessionId?: string };

    if (initBody.error) {
      throw new Error(`MCP error ${initBody.error.code}: ${initBody.error.message}`);
    }

    if (!initBody.sessionId) {
      // Not a streaming response — yield result directly
      yield initBody.result;
      return;
    }

    // Connect to SSE endpoint
    const eventsUrl = `${this.baseUrl}/mcp/events/${initBody.sessionId}`;
    const eventsResp = await fetch(eventsUrl);
    if (!eventsResp.ok || !eventsResp.body) {
      throw new Error(`SSE connection failed: ${eventsResp.status}`);
    }

    const reader = new SSEReader(eventsResp.body);
    for await (const event of reader.events()) {
      if (event.event === 'done') return;
      try {
        yield JSON.parse(event.data);
      } catch {
        yield event.data;
      }
    }
  }

  /**
   * Health check.
   */
  async healthCheck(): Promise<{ status: string; version: string }> {
    return this.circuitBreaker.execute(async () => {
      const resp = await fetch(`${this.baseUrl}/health`);
      if (!resp.ok) throw new Error(`Health check failed: ${resp.status}`);
      return (await resp.json()) as { status: string; version: string };
    });
  }

  // ── Internals ──

  private async postWithRetry(path: string, body: TransportMessage): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.dct) {
      headers['Authorization'] = `Bearer ${this.dct.token}`;
    }

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        return resp;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.retryConfig.maxRetries) {
          const delay = Math.min(
            this.retryConfig.baseDelayMs * 2 ** attempt,
            this.retryConfig.maxDelayMs,
          );
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    throw lastError ?? new Error('Request failed');
  }
}
