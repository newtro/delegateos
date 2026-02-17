/**
 * MCP HTTP Server — routes MCP calls over HTTP with SSE streaming support.
 * Uses Node.js built-in http module (no Express).
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { MCPPlugin } from '../mcp/plugin.js';
import type { MCPRequest } from '../mcp/types.js';
import type { AgentRegistry } from '../a2a/registry.js';
import type { TransportConfig, TransportMessage, TransportResponse, TransportError } from './types.js';
import { SSEWriter } from './sse.js';
import { createLogger, type Logger } from '../core/logger.js';
import { globalMetrics, type MetricsCollector } from '../core/metrics.js';
import { RateLimitMiddleware, type RateLimitResult } from './rate-limiter.js';

/** Active SSE session */
interface SSESession {
  id: string;
  writer: SSEWriter | null;
  createdAt: number;
}

/** Maximum request body size in bytes (1 MB) */
const MAX_BODY_BYTES = 1_048_576;

/** Maximum concurrent SSE sessions */
const MAX_SSE_SESSIONS = 100;

/** Request timeout in milliseconds (30s) */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * HTTP server that exposes MCP middleware over HTTP with SSE streaming.
 */
export class MCPHttpServer {
  private server: Server | null = null;
  private sessions = new Map<string, SSESession>();
  private startedAt = 0;
  private connections = new Set<import('node:net').Socket>();
  private logger: Logger;
  private metrics: MetricsCollector;
  private rateLimiter: RateLimitMiddleware;

  constructor(
    private config: TransportConfig,
    private mcpPlugin: MCPPlugin,
    private registry?: AgentRegistry,
    opts?: { metrics?: MetricsCollector; rateLimiter?: RateLimitMiddleware },
  ) {
    this.logger = createLogger('MCPHttpServer');
    this.metrics = opts?.metrics ?? globalMetrics;
    this.rateLimiter = opts?.rateLimiter ?? new RateLimitMiddleware();
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));
      this.server.on('connection', (socket) => {
        this.connections.add(socket);
        socket.on('close', () => this.connections.delete(socket));
      });
      this.server.listen(this.config.port, this.config.host, () => {
        this.startedAt = Date.now();
        this.logger.info('Server started', { port: this.port, host: this.config.host });
        this.rateLimiter.startCleanup();
        resolve();
      });
      this.server.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    this.logger.info('Server stopping');
    this.rateLimiter.stopCleanup();

    // Close all SSE sessions
    for (const session of this.sessions.values()) {
      session.writer?.close();
    }
    this.sessions.clear();

    // Destroy active connections
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();

    return new Promise((resolve) => {
      if (!this.server) { resolve(); return; }
      this.server.close(() => resolve());
    });
  }

  /** The actual port after listen (useful when port=0) */
  get port(): number {
    const addr = this.server?.address();
    if (addr && typeof addr === 'object') return addr.port;
    return this.config.port;
  }

  // ── Request Router ──

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const startTime = Date.now();

    // CORS
    this.setCors(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;
    const base = this.config.basePath;

    // Rate limiting
    const clientIp = req.socket.remoteAddress ?? 'unknown';
    const rlResult = this.rateLimiter.checkRequest(path, { ip: clientIp });
    if (!rlResult.allowed) {
      this.metrics.counter('http.rate_limited', { path });
      this.logger.warn('Rate limited', { ip: clientIp, path, retryAfterMs: rlResult.retryAfterMs });
      res.setHeader('Retry-After', String(Math.ceil((rlResult.retryAfterMs ?? 1000) / 1000)));
      this.sendJson(res, 429, { error: { code: 429, message: 'Too many requests' } });
      return;
    }

    this.metrics.counter('http.requests', { method: req.method ?? 'UNKNOWN', path });

    try {
      if (req.method === 'GET' && path === `${base}/health`) {
        return this.handleHealth(res);
      }
      if (req.method === 'GET' && path === `${base}/metrics`) {
        return this.handleMetrics(res);
      }
      if (req.method === 'GET' && path === `${base}/agents`) {
        return this.handleAgents(res);
      }
      if (req.method === 'POST' && path === `${base}/mcp/message`) {
        return await this.handleMessage(req, res);
      }
      if (req.method === 'POST' && path === `${base}/mcp/stream`) {
        return await this.handleStream(req, res);
      }
      if (req.method === 'GET' && path.startsWith(`${base}/mcp/events/`)) {
        const sessionId = path.slice(`${base}/mcp/events/`.length);
        return this.handleEvents(sessionId, res);
      }

      this.sendJson(res, 404, { error: { code: 404, message: 'Not found' } });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      this.logger.error('Request error', { method: req.method, path: req.url, error: message });
      this.metrics.counter('http.errors', { path });
      this.sendJson(res, 500, {
        error: { code: 500, message },
      });
    } finally {
      this.metrics.histogram('http.duration_ms', Date.now() - startTime, { path });
    }
  }

  // ── Route Handlers ──

  private handleHealth(res: ServerResponse): void {
    this.sendJson(res, 200, {
      status: 'ok',
      version: '0.3.0',
      uptime: Date.now() - this.startedAt,
    });
  }

  private handleMetrics(res: ServerResponse): void {
    this.sendJson(res, 200, this.metrics.getSnapshot());
  }

  private handleAgents(res: ServerResponse): void {
    if (!this.registry) {
      this.sendJson(res, 200, { agents: [] });
      return;
    }
    this.sendJson(res, 200, { agents: this.registry.listAll() });
  }

  private async handleMessage(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.includes('application/json')) {
      this.sendJson(res, 415, { error: { code: 415, message: 'Content-Type must be application/json' } });
      return;
    }

    const body = await this.readBody(req);
    if (!body) {
      this.sendJson(res, 400, { error: { code: 400, message: 'Invalid JSON body' } });
      return;
    }

    const msg = body as TransportMessage;
    if (!msg.id || !msg.method) {
      this.sendJson(res, 400, { error: { code: 400, message: 'Missing id or method' } });
      return;
    }

    // Extract DCT from Authorization header or body
    const dct = this.extractDCT(req) ?? msg.dct;

    // Build MCP request
    const mcpReq = this.toMCPRequest(msg, dct);

    // Pass through plugin
    const result = await this.mcpPlugin.handleRequest(mcpReq);

    if ('error' in result) {
      // Plugin returned an error response
      const resp: TransportResponse = {
        id: msg.id,
        error: { code: result.error.code, message: result.error.message, data: result.error.data },
      };
      this.sendJson(res, 200, resp);
      return;
    }

    // Plugin passed it through — simulate execution (return params as result)
    const resp: TransportResponse = {
      id: msg.id,
      result: { method: (result as MCPRequest).method, params: (result as MCPRequest).params },
    };
    this.sendJson(res, 200, resp);
  }

  private async handleStream(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.includes('application/json')) {
      this.sendJson(res, 415, { error: { code: 415, message: 'Content-Type must be application/json' } });
      return;
    }

    const body = await this.readBody(req);
    if (!body) {
      this.sendJson(res, 400, { error: { code: 400, message: 'Invalid JSON body' } });
      return;
    }

    const msg = body as TransportMessage;
    if (!msg.id || !msg.method) {
      this.sendJson(res, 400, { error: { code: 400, message: 'Missing id or method' } });
      return;
    }

    const dct = this.extractDCT(req) ?? msg.dct;
    const mcpReq = this.toMCPRequest(msg, dct);
    const result = await this.mcpPlugin.handleRequest(mcpReq);

    if ('error' in result) {
      const resp: TransportResponse = {
        id: msg.id,
        error: { code: result.error.code, message: result.error.message, data: result.error.data },
      };
      this.sendJson(res, 200, resp);
      return;
    }

    // Check SSE session limit
    if (this.sessions.size >= MAX_SSE_SESSIONS) {
      this.sendJson(res, 503, { error: { code: 503, message: 'Too many active streaming sessions' } });
      return;
    }

    // Create SSE session (writer will be set when client connects to events endpoint)
    const sessionId = randomUUID();

    this.sessions.set(sessionId, {
      id: sessionId,
      writer: null,
      createdAt: Date.now(),
    });

    // Auto-cleanup after 60s
    setTimeout(() => {
      const s = this.sessions.get(sessionId);
      if (s) {
        s.writer?.close();
        this.sessions.delete(sessionId);
      }
    }, 60_000);

    this.sendJson(res, 200, { id: msg.id, stream: true, sessionId });
  }

  private handleEvents(sessionId: string, res: ServerResponse): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.sendJson(res, 404, { error: { code: 404, message: 'Session not found' } });
      return;
    }

    const writer = new SSEWriter(res, 15_000);
    session.writer = writer;

    // Send a connected event
    writer.send({ event: 'connected', data: JSON.stringify({ sessionId }) });
  }

  /**
   * Push an event to an active SSE session (called externally).
   */
  pushEvent(sessionId: string, event: string, data: unknown): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.writer || session.writer.isClosed) return false;
    session.writer.send({ event, data: JSON.stringify(data), id: randomUUID() });
    return true;
  }

  /**
   * Close an SSE session.
   */
  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.writer?.close();
      this.sessions.delete(sessionId);
    }
  }

  // ── Helpers ──

  private extractDCT(req: IncomingMessage): string | undefined {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      return auth.slice(7);
    }
    return undefined;
  }

  private toMCPRequest(msg: TransportMessage, dct?: string): MCPRequest {
    const params = (typeof msg.params === 'object' && msg.params !== null ? msg.params : {}) as Record<string, unknown>;
    const mcpReq: MCPRequest = {
      jsonrpc: '2.0',
      method: msg.method,
      id: msg.id,
      params: { ...params },
    };

    if (dct) {
      mcpReq.params._delegateos = {
        dct,
        format: 'delegateos-sjt-v1',
        delegationId: (params._delegateos as Record<string, string>)?.delegationId ?? 'unknown',
        contractId: (params._delegateos as Record<string, string>)?.contractId ?? 'unknown',
      };
    }

    return mcpReq;
  }

  private setCors(res: ServerResponse): void {
    const origins = this.config.corsOrigins;
    res.setHeader('Access-Control-Allow-Origin', origins && origins.length > 0 ? origins[0] : '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  private sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private readBody(req: IncomingMessage): Promise<unknown | null> {
    return new Promise((resolve) => {
      let data = '';
      let size = 0;
      const timeout = setTimeout(() => {
        req.destroy();
        resolve(null);
      }, REQUEST_TIMEOUT_MS);

      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          clearTimeout(timeout);
          req.destroy();
          resolve(null);
          return;
        }
        data += chunk.toString();
      });
      req.on('end', () => {
        clearTimeout(timeout);
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
      req.on('error', () => {
        clearTimeout(timeout);
        resolve(null);
      });
    });
  }
}
