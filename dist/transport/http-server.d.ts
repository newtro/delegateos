/**
 * MCP HTTP Server — routes MCP calls over HTTP with SSE streaming support.
 * Uses Node.js built-in http module (no Express).
 */
import type { MCPPlugin } from '../mcp/plugin.js';
import type { AgentRegistry } from '../a2a/registry.js';
import type { TransportConfig } from './types.js';
import { type MetricsCollector } from '../core/metrics.js';
import { RateLimitMiddleware } from './rate-limiter.js';
/**
 * HTTP server that exposes MCP middleware over HTTP with SSE streaming.
 */
export declare class MCPHttpServer {
    private config;
    private mcpPlugin;
    private registry?;
    private server;
    private sessions;
    private startedAt;
    private connections;
    private logger;
    private metrics;
    private rateLimiter;
    constructor(config: TransportConfig, mcpPlugin: MCPPlugin, registry?: AgentRegistry | undefined, opts?: {
        metrics?: MetricsCollector;
        rateLimiter?: RateLimitMiddleware;
    });
    start(): Promise<void>;
    stop(): Promise<void>;
    /** The actual port after listen (useful when port=0) */
    get port(): number;
    private handleRequest;
    private handleHealth;
    private handleMetrics;
    private handleAgents;
    private handleMessage;
    private handleStream;
    private handleEvents;
    /**
     * Push an event to an active SSE session (called externally).
     */
    pushEvent(sessionId: string, event: string, data: unknown): boolean;
    /**
     * Close an SSE session.
     */
    closeSession(sessionId: string): void;
    private extractDCT;
    private toMCPRequest;
    private setCors;
    private sendJson;
    private readBody;
}
