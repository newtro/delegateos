// DelegateOS MCP Middleware Plugin
// Intercepts tools/call requests, enforces DCT permissions

import { verifyDCT, inspectDCT } from '../core/dct.js';
import type { SerializedDCT, RevocationEntry, VerificationContext, DenialReason } from '../core/types.js';
import type { MCPPluginConfig, MCPRequest, MCPErrorResponse, DelegateOSMeta } from './types.js';
import { AuditLog } from './audit.js';
import { createLogger } from '../core/logger.js';
import { globalMetrics } from '../core/metrics.js';

export function createMCPPlugin(config: MCPPluginConfig) {
  const audit = new AuditLog();
  const logger = createLogger('MCPPlugin');
  let _lastAuthorizedMeta: DelegateOSMeta | null = null;

  function makeError(id: string | number | undefined, code: number, message: string, data?: unknown): MCPErrorResponse {
    return {
      jsonrpc: '2.0',
      id,
      error: { code, message, data },
    };
  }

  function parseDCT(meta: DelegateOSMeta): SerializedDCT {
    return {
      token: meta.dct,
      format: meta.format as SerializedDCT['format'],
    };
  }

  async function handleRequest(req: MCPRequest): Promise<MCPRequest | MCPErrorResponse> {
    // Only intercept tools/call
    if (req.method !== 'tools/call') {
      audit.passthrough(req.method);
      return req;
    }

    const meta = req.params?._delegateos;

    // No DelegateOS metadata — pass through unchanged
    if (!meta) {
      audit.passthrough(req.method);
      globalMetrics.counter('mcp.passthrough');
      return req;
    }

    const toolName = req.params?.name;
    if (!toolName) {
      audit.denied({
        method: req.method,
        delegationId: meta.delegationId,
        contractId: meta.contractId,
        reason: 'Missing tool name',
        denialType: 'malformed_request',
      });
      return makeError(req.id, -32001, 'DCT verification failed', {
        type: 'malformed_token',
        detail: 'Missing tool name in request',
      });
    }

    // Map tool to capability
    const toolMapping = config.toolCapabilities[toolName];
    if (!toolMapping) {
      audit.denied({
        method: req.method,
        toolName,
        delegationId: meta.delegationId,
        contractId: meta.contractId,
        reason: `No capability mapping for tool: ${toolName}`,
        denialType: 'capability_not_granted',
      });
      return makeError(req.id, -32001, 'DCT verification failed', {
        type: 'capability_not_granted',
        detail: `No capability mapping for tool: ${toolName}`,
      });
    }

    // Determine resource from arguments
    const resource = toolMapping.resourceExtractor
      ? toolMapping.resourceExtractor(req.params.arguments ?? {})
      : '*';

    // Deserialize and verify DCT
    let token: SerializedDCT;
    try {
      token = parseDCT(meta);
    } catch {
      audit.denied({
        method: req.method,
        toolName,
        delegationId: meta.delegationId,
        contractId: meta.contractId,
        reason: 'Failed to deserialize DCT',
        denialType: 'malformed_token',
      });
      return makeError(req.id, -32001, 'DCT verification failed', {
        type: 'malformed_token',
        detail: 'Failed to deserialize DCT',
      });
    }

    // Build verification context
    const context: VerificationContext = {
      resource,
      namespace: toolMapping.namespace,
      operation: toolMapping.action,
      now: new Date().toISOString(),
      spentMicrocents: config.budgetTracker.getSpent(meta.delegationId),
      rootPublicKey: '', // Will be matched against trustedRoots
      revocationIds: config.revocations.getRevocationIds(),
    };

    // Try each trusted root
    let lastDenial: DenialReason | null = null;
    let authorized = false;

    for (const root of config.trustedRoots) {
      context.rootPublicKey = root;
      const result = verifyDCT(token, context);
      if (result.ok) {
        authorized = true;
        globalMetrics.counter('mcp.authorized', { tool: toolName as string });
        logger.info('DCT authorized', { tool: toolName, delegationId: meta.delegationId });

        // Capture meta before stripping for spend tracking
        _lastAuthorizedMeta = meta;

        audit.allowed({
          method: req.method,
          toolName,
          delegationId: meta.delegationId,
          contractId: meta.contractId,
          resource,
          operation: toolMapping.action,
        });

        // Strip _delegateos and forward
        const forwarded: MCPRequest = {
          ...req,
          params: { ...req.params },
        };
        delete forwarded.params._delegateos;
        return forwarded;
      } else {
        lastDenial = result.error;
      }
    }

    // All roots failed
    globalMetrics.counter('mcp.denied', { tool: toolName as string });
    logger.warn('DCT denied', { tool: toolName, delegationId: meta.delegationId, reason: lastDenial?.type });
    audit.denied({
      method: req.method,
      toolName,
      delegationId: meta.delegationId,
      contractId: meta.contractId,
      reason: lastDenial ? JSON.stringify(lastDenial) : 'No trusted roots matched',
      denialType: lastDenial?.type ?? 'invalid_signature',
      resource,
      operation: toolMapping.action,
    });

    return makeError(req.id, -32001, 'DCT verification failed', lastDenial ?? {
      type: 'invalid_signature',
      detail: 'No trusted roots matched',
    });
  }

  async function handleResponse(req: MCPRequest, res: unknown): Promise<unknown> {
    // Record spend if this was an authorized tools/call
    // Note: req here may have _delegateos stripped by handleRequest.
    // Use _lastAuthorizedMeta which was captured before stripping.
    if (req.method === 'tools/call' && _lastAuthorizedMeta) {
      // Simple cost model: 100 microcents per tool call
      config.budgetTracker.recordSpend(_lastAuthorizedMeta.delegationId, 100);
      _lastAuthorizedMeta = null;
    }
    return res;
  }

  function addRevocation(entry: RevocationEntry): void {
    config.revocations.add(entry);
  }

  function getAuditLog(): AuditLog {
    return audit;
  }

  return {
    handleRequest,
    handleResponse,
    addRevocation,
    getAuditLog,
  };
}

export type MCPPlugin = ReturnType<typeof createMCPPlugin>;
