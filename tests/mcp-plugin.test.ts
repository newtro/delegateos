import { describe, it, expect, beforeEach } from 'vitest';
import { createMCPPlugin } from '../src/mcp/plugin.js';
import { createDCT, getRevocationIds } from '../src/core/dct.js';
import { generateKeypair } from '../src/core/crypto.js';
import { InMemoryRevocationList, createRevocationEntry } from '../src/core/revocation.js';
import { InMemoryBudgetTracker } from '../src/mcp/types.js';
import type { MCPPluginConfig, MCPRequest, MCPErrorResponse } from '../src/mcp/types.js';
import type { Capability, SerializedDCT } from '../src/core/types.js';

function futureISO(hours = 1): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

function isError(res: unknown): res is MCPErrorResponse {
  return typeof res === 'object' && res !== null && 'error' in res;
}

describe('MCP Plugin', () => {
  const root = generateKeypair('root');
  const agent = generateKeypair('agent');

  const caps: Capability[] = [
    { namespace: 'code', action: 'read', resource: '*' },
    { namespace: 'code', action: 'write', resource: '/src/**' },
  ];

  let revocations: InMemoryRevocationList;
  let budgetTracker: InMemoryBudgetTracker;
  let config: MCPPluginConfig;
  let token: SerializedDCT;

  beforeEach(() => {
    revocations = new InMemoryRevocationList();
    budgetTracker = new InMemoryBudgetTracker();
    config = {
      toolCapabilities: {
        read_file: {
          namespace: 'code',
          action: 'read',
          resourceExtractor: (args) => (args.path as string) ?? '*',
        },
        write_file: {
          namespace: 'code',
          action: 'write',
          resourceExtractor: (args) => (args.path as string) ?? '*',
        },
        search: {
          namespace: 'web',
          action: 'search',
        },
      },
      trustedRoots: [root.principal.id],
      revocations,
      budgetTracker,
    };

    token = createDCT({
      issuer: root,
      delegatee: agent.principal,
      capabilities: caps,
      contractId: 'ct_test',
      delegationId: 'del_test',
      parentDelegationId: 'del_root',
      chainDepth: 0,
      maxChainDepth: 3,
      maxBudgetMicrocents: 1000,
      expiresAt: futureISO(1),
    });
  });

  function makeRequest(toolName: string, args: Record<string, unknown> = {}, dct?: SerializedDCT): MCPRequest {
    const t = dct ?? token;
    return {
      jsonrpc: '2.0',
      method: 'tools/call',
      id: 1,
      params: {
        name: toolName,
        arguments: args,
        _delegateos: {
          dct: t.token,
          format: t.format,
          delegationId: 'del_test',
          contractId: 'ct_test',
        },
      },
    };
  }

  it('authorized request passes through', async () => {
    const plugin = createMCPPlugin(config);
    const req = makeRequest('read_file', { path: '/README.md' });
    const result = await plugin.handleRequest(req);
    expect(isError(result)).toBe(false);
    // _delegateos should be stripped
    expect((result as MCPRequest).params._delegateos).toBeUndefined();
  });

  it('unauthorized request is denied (wrong namespace)', async () => {
    const plugin = createMCPPlugin(config);
    // 'search' tool maps to namespace 'web', but token only has 'code' caps
    const req = makeRequest('search', {});
    const result = await plugin.handleRequest(req);
    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.error.data).toHaveProperty('type', 'capability_not_granted');
    }
  });

  it('unauthorized request is denied (no capability mapping)', async () => {
    const plugin = createMCPPlugin(config);
    const req = makeRequest('unknown_tool', {});
    const result = await plugin.handleRequest(req);
    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.error.data).toHaveProperty('type', 'capability_not_granted');
    }
  });

  it('revoked token is rejected', async () => {
    const plugin = createMCPPlugin(config);
    const revIds = getRevocationIds(token);
    const entry = createRevocationEntry(root, revIds[0]);
    revocations.add(entry);

    const req = makeRequest('read_file', { path: '/README.md' });
    const result = await plugin.handleRequest(req);
    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.error.data).toHaveProperty('type', 'revoked');
    }
  });

  it('budget exceeded is rejected', async () => {
    const plugin = createMCPPlugin(config);
    // Pre-spend the entire budget
    budgetTracker.recordSpend('del_test', 1000);

    const req = makeRequest('read_file', { path: '/README.md' });
    const result = await plugin.handleRequest(req);
    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.error.data).toHaveProperty('type', 'budget_exceeded');
    }
  });

  it('audit log records decisions', async () => {
    const plugin = createMCPPlugin(config);

    // Allowed request
    const req1 = makeRequest('read_file', { path: '/README.md' });
    await plugin.handleRequest(req1);

    // Denied request (no mapping)
    const req2: MCPRequest = {
      jsonrpc: '2.0',
      method: 'tools/call',
      id: 2,
      params: {
        name: 'unknown_tool',
        arguments: {},
        _delegateos: {
          dct: token.token,
          format: token.format,
          delegationId: 'del_test',
          contractId: 'ct_test',
        },
      },
    };
    await plugin.handleRequest(req2);

    const audit = plugin.getAuditLog();
    const entries = audit.getEntries();
    expect(entries.length).toBe(2);
    expect(entries[0].decision).toBe('allowed');
    expect(entries[1].decision).toBe('denied');
  });

  it('spend tracking works after stripping _delegateos', async () => {
    const plugin = createMCPPlugin(config);
    const req = makeRequest('read_file', { path: '/README.md' });
    const result = await plugin.handleRequest(req);
    expect(isError(result)).toBe(false);

    // handleResponse with the stripped request should still record spend
    await plugin.handleResponse(result as MCPRequest, { jsonrpc: '2.0', id: 1, result: 'ok' });
    expect(budgetTracker.getSpent('del_test')).toBe(100);
  });

  it('passthrough without _delegateos metadata', async () => {
    const plugin = createMCPPlugin(config);
    const req: MCPRequest = {
      jsonrpc: '2.0',
      method: 'tools/call',
      id: 1,
      params: { name: 'read_file', arguments: {} },
    };
    const result = await plugin.handleRequest(req);
    expect(isError(result)).toBe(false);
    const audit = plugin.getAuditLog();
    expect(audit.getEntries()[0].decision).toBe('passthrough');
  });
});
