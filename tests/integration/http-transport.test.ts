/**
 * Integration tests — HTTP+SSE transport with real server and client.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MCPHttpServer } from '../../src/transport/http-server.js';
import { MCPHttpClient } from '../../src/transport/http-client.js';
import { createMCPPlugin } from '../../src/mcp/plugin.js';
import { InMemoryBudgetTracker } from '../../src/mcp/types.js';
import { InMemoryRevocationList } from '../../src/core/revocation.js';
import { AgentRegistry } from '../../src/a2a/registry.js';
import { generateKeypair, signObject } from '../../src/core/crypto.js';
import { createDCT } from '../../src/core/dct.js';
import type { TransportConfig } from '../../src/transport/types.js';
import type { MCPPluginConfig } from '../../src/mcp/types.js';
import type { AgentCard } from '../../src/a2a/types.js';
import type { SerializedDCT } from '../../src/core/types.js';

function futureISO(hours = 1): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

function pastISO(hours = 1): string {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

describe('HTTP Transport Integration', () => {
  const root = generateKeypair('root');
  const agent = generateKeypair('agent');
  let server: MCPHttpServer;
  let baseUrl: string;
  let validDCT: SerializedDCT;
  let registry: AgentRegistry;

  beforeAll(async () => {
    const revocations = new InMemoryRevocationList();
    const budgetTracker = new InMemoryBudgetTracker();

    const pluginConfig: MCPPluginConfig = {
      toolCapabilities: {
        read_file: { namespace: 'code', action: 'read', resourceExtractor: (a) => (a.path as string) ?? '*' },
        write_file: { namespace: 'code', action: 'write', resourceExtractor: (a) => (a.path as string) ?? '*' },
      },
      trustedRoots: [root.principal.id],
      revocations,
      budgetTracker,
    };

    const plugin = createMCPPlugin(pluginConfig);

    registry = new AgentRegistry();
    const kp = generateKeypair('TestAgent');
    const card: AgentCard = {
      id: 'agent_test',
      name: 'TestAgent',
      description: 'A test agent',
      principal: kp.principal.id,
      capabilities: [{ namespace: 'code', action: 'read', resource: '**' }],
      delegationPolicy: { acceptsDelegation: true, maxChainDepth: 3, requiredTrustScore: 0, allowedNamespaces: ['code'] },
      metadata: {},
      signature: '',
    };
    const { signature: _, ...toSign } = card;
    card.signature = signObject(kp.privateKey, toSign);
    registry.register(card);

    const config: TransportConfig = {
      port: 0,
      host: '127.0.0.1',
      basePath: '',
      corsOrigins: ['http://localhost:3000'],
      authRequired: true,
    };

    server = new MCPHttpServer(config, plugin, registry);
    await server.start();
    baseUrl = `http://127.0.0.1:${server.port}`;

    validDCT = createDCT({
      issuer: root,
      delegatee: agent.principal,
      capabilities: [
        { namespace: 'code', action: 'read', resource: '*' },
        { namespace: 'code', action: 'write', resource: '/src/**' },
      ],
      contractId: 'ct_test',
      delegationId: 'del_test',
      parentDelegationId: 'del_root',
      chainDepth: 0,
      maxChainDepth: 3,
      maxBudgetMicrocents: 10000,
      expiresAt: futureISO(1),
    });
  });

  afterAll(async () => {
    await server.stop();
  });

  // ── Health ──

  it('returns health status', async () => {
    const resp = await fetch(`${baseUrl}/health`);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.3.0');
    expect(typeof body.uptime).toBe('number');
  });

  it('client healthCheck works', async () => {
    const client = new MCPHttpClient(baseUrl);
    const health = await client.healthCheck();
    expect(health.status).toBe('ok');
    expect(health.version).toBe('0.3.0');
  });

  // ── Agents ──

  it('lists registered agents', async () => {
    const resp = await fetch(`${baseUrl}/agents`);
    expect(resp.status).toBe(200);
    const body = await resp.json() as { agents: AgentCard[] };
    expect(body.agents.length).toBe(1);
    expect(body.agents[0].name).toBe('TestAgent');
  });

  // ── MCP Message ──

  it('passes valid MCP call with DCT in Authorization header', async () => {
    const client = new MCPHttpClient(baseUrl, validDCT);
    const result = await client.call('tools/call', {
      name: 'read_file',
      arguments: { path: '/readme.md' },
      _delegateos: {
        dct: validDCT.token,
        format: validDCT.format,
        delegationId: 'del_test',
        contractId: 'ct_test',
      },
    });
    expect(result).toBeDefined();
  });

  it('rejects MCP call without DCT when tool requires it', async () => {
    const resp = await fetch(`${baseUrl}/mcp/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: '1',
        method: 'tools/call',
        params: {
          name: 'read_file',
          arguments: { path: '/test.txt' },
          _delegateos: {
            dct: 'invalid-token',
            format: 'delegateos-sjt-v1',
            delegationId: 'del_bad',
            contractId: 'ct_bad',
          },
        },
      }),
    });
    expect(resp.status).toBe(200); // JSON-RPC errors in body
    const body = await resp.json();
    expect(body.error).toBeDefined();
  });

  it('rejects expired DCT', async () => {
    const expiredDCT = createDCT({
      issuer: root,
      delegatee: agent.principal,
      capabilities: [{ namespace: 'code', action: 'read', resource: '*' }],
      contractId: 'ct_test',
      delegationId: 'del_expired',
      parentDelegationId: 'del_root',
      chainDepth: 0,
      maxChainDepth: 3,
      maxBudgetMicrocents: 1000,
      expiresAt: pastISO(1),
    });

    const resp = await fetch(`${baseUrl}/mcp/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${expiredDCT.token}`,
      },
      body: JSON.stringify({
        id: '2',
        method: 'tools/call',
        params: {
          name: 'read_file',
          arguments: { path: '/test.txt' },
          _delegateos: {
            dct: expiredDCT.token,
            format: expiredDCT.format,
            delegationId: 'del_expired',
            contractId: 'ct_test',
          },
        },
      }),
    });
    const body = await resp.json();
    expect(body.error).toBeDefined();
  });

  it('rejects request with insufficient capabilities', async () => {
    const readOnlyDCT = createDCT({
      issuer: root,
      delegatee: agent.principal,
      capabilities: [{ namespace: 'code', action: 'read', resource: '*' }],
      contractId: 'ct_test',
      delegationId: 'del_readonly',
      parentDelegationId: 'del_root',
      chainDepth: 0,
      maxChainDepth: 3,
      maxBudgetMicrocents: 1000,
      expiresAt: futureISO(1),
    });

    const resp = await fetch(`${baseUrl}/mcp/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${readOnlyDCT.token}`,
      },
      body: JSON.stringify({
        id: '3',
        method: 'tools/call',
        params: {
          name: 'write_file',
          arguments: { path: '/src/main.ts' },
          _delegateos: {
            dct: readOnlyDCT.token,
            format: readOnlyDCT.format,
            delegationId: 'del_readonly',
            contractId: 'ct_test',
          },
        },
      }),
    });
    const body = await resp.json();
    expect(body.error).toBeDefined();
  });

  // ── CORS ──

  it('returns CORS headers on OPTIONS', async () => {
    const resp = await fetch(`${baseUrl}/mcp/message`, { method: 'OPTIONS' });
    expect(resp.status).toBe(204);
    expect(resp.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(resp.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('returns CORS headers on regular requests', async () => {
    const resp = await fetch(`${baseUrl}/health`);
    expect(resp.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });

  // ── 404 ──

  it('returns 404 for unknown routes', async () => {
    const resp = await fetch(`${baseUrl}/nonexistent`);
    expect(resp.status).toBe(404);
  });

  // ── Invalid Body ──

  it('returns 400 for invalid JSON body', async () => {
    const resp = await fetch(`${baseUrl}/mcp/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(resp.status).toBe(400);
  });

  it('returns 400 for missing id or method', async () => {
    const resp = await fetch(`${baseUrl}/mcp/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ something: 'else' }),
    });
    expect(resp.status).toBe(400);
  });

  // ── Non-tools/call passthrough ──

  it('passes through non-tools/call methods', async () => {
    const resp = await fetch(`${baseUrl}/mcp/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '10', method: 'resources/list', params: {} }),
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.result).toBeDefined();
    expect(body.error).toBeUndefined();
  });

  // ── SSE Stream ──

  it('initiates SSE stream session', async () => {
    const resp = await fetch(`${baseUrl}/mcp/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '20', method: 'resources/list', params: {} }),
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.stream).toBe(true);
    expect(body.sessionId).toBeDefined();
  });

  it('pushes events to SSE session and closes it', async () => {
    // Initiate stream
    const initResp = await fetch(`${baseUrl}/mcp/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '30', method: 'resources/list', params: {} }),
    });
    const initBody = await initResp.json() as { sessionId: string };
    const sessionId = initBody.sessionId;
    expect(sessionId).toBeDefined();

    // Connect to SSE events endpoint (don't await body — it's a stream)
    const controller = new AbortController();
    const eventsPromise = fetch(`${baseUrl}/mcp/events/${sessionId}`, { signal: controller.signal });
    const eventsResp = await eventsPromise;
    expect(eventsResp.status).toBe(200);
    expect(eventsResp.headers.get('content-type')).toContain('text/event-stream');

    // Give server a tick to set up the writer
    await new Promise(r => setTimeout(r, 50));

    // Push events from server side
    const pushed = server.pushEvent(sessionId, 'progress', { step: 1, total: 3 });
    expect(pushed).toBe(true);

    server.pushEvent(sessionId, 'progress', { step: 2, total: 3 });
    server.pushEvent(sessionId, 'complete', { result: 'done' });

    // Close
    server.closeSession(sessionId);
    controller.abort();

    // Verify session gone
    expect(server.pushEvent(sessionId, 'test', {})).toBe(false);
  });

  it('returns 404 for nonexistent SSE session', async () => {
    const resp = await fetch(`${baseUrl}/mcp/events/nonexistent-session`);
    expect(resp.status).toBe(404);
  });

  // ── Graceful Shutdown ──

  it('gracefully shuts down and restarts', async () => {
    // Create a separate server for shutdown test
    const revocations = new InMemoryRevocationList();
    const budgetTracker = new InMemoryBudgetTracker();
    const plugin = createMCPPlugin({
      toolCapabilities: {},
      trustedRoots: [],
      revocations,
      budgetTracker,
    });

    const shutdownServer = new MCPHttpServer(
      { port: 0, host: '127.0.0.1', basePath: '', authRequired: false },
      plugin,
    );

    await shutdownServer.start();
    const shutdownUrl = `http://127.0.0.1:${shutdownServer.port}`;

    // Verify it works
    const resp = await fetch(`${shutdownUrl}/health`);
    expect(resp.status).toBe(200);

    // Stop
    await shutdownServer.stop();

    // Should fail to connect now
    await expect(fetch(`${shutdownUrl}/health`)).rejects.toThrow();
  });

  it('rejects POST without Content-Type: application/json', async () => {
    const resp = await fetch(`${baseUrl}/mcp/message`, {
      method: 'POST',
      body: JSON.stringify({ id: '1', method: 'tools/call' }),
    });
    expect(resp.status).toBe(415);
  });

  it('rejects POST with invalid JSON body', async () => {
    const resp = await fetch(`${baseUrl}/mcp/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json at all{{{',
    });
    expect(resp.status).toBe(400);
  });

  // ── Metrics Endpoint ──

  it('returns metrics snapshot', async () => {
    const resp = await fetch(`${baseUrl}/metrics`);
    expect(resp.status).toBe(200);
    const body = await resp.json() as { counters: Record<string, unknown>; collectedAt: string };
    expect(body.counters).toBeDefined();
    expect(body.collectedAt).toBeDefined();
  });

  // ── Rate Limiting ──

  it('enforces rate limiting with custom config', async () => {
    const revocations = new InMemoryRevocationList();
    const budgetTracker = new InMemoryBudgetTracker();
    const plugin = createMCPPlugin({
      toolCapabilities: {},
      trustedRoots: [],
      revocations,
      budgetTracker,
    });

    const { RateLimitMiddleware } = await import('../../src/transport/rate-limiter.js');
    const rateLimiter = new RateLimitMiddleware({
      defaultConfig: { maxTokens: 3, refillRate: 1, refillIntervalMs: 60_000 },
    });

    const rlServer = new MCPHttpServer(
      { port: 0, host: '127.0.0.1', basePath: '', authRequired: false },
      plugin,
      undefined,
      { rateLimiter },
    );

    await rlServer.start();
    const rlUrl = `http://127.0.0.1:${rlServer.port}`;

    // First 3 requests should succeed
    for (let i = 0; i < 3; i++) {
      const resp = await fetch(`${rlUrl}/health`);
      expect(resp.status).toBe(200);
    }

    // 4th request should be rate limited
    const resp = await fetch(`${rlUrl}/health`);
    expect(resp.status).toBe(429);
    const body = await resp.json() as { error: { code: number } };
    expect(body.error.code).toBe(429);

    await rlServer.stop();
  });
});
