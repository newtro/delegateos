import type { RevocationListInterface } from '../core/revocation.js';
/** Maps MCP tool names to DelegateOS capabilities */
export interface ToolCapabilityMap {
    [toolName: string]: {
        namespace: string;
        action: string;
        resourceExtractor?: (args: Record<string, unknown>) => string;
    };
}
/** Budget tracking per delegation */
export interface BudgetTracker {
    getSpent(delegationId: string): number;
    recordSpend(delegationId: string, microcents: number): void;
}
/** Simple in-memory budget tracker */
export declare class InMemoryBudgetTracker implements BudgetTracker {
    private spent;
    getSpent(delegationId: string): number;
    recordSpend(delegationId: string, microcents: number): void;
}
/** MCP Plugin configuration */
export interface MCPPluginConfig {
    toolCapabilities: ToolCapabilityMap;
    trustedRoots: string[];
    revocations: RevocationListInterface;
    budgetTracker: BudgetTracker;
}
/** DelegateOS metadata attached to MCP requests */
export interface DelegateOSMeta {
    dct: string;
    format: string;
    delegationId: string;
    contractId: string;
}
/** MCP JSON-RPC 2.0 request */
export interface MCPRequest {
    jsonrpc: '2.0';
    method: string;
    id?: string | number;
    params: {
        name?: string;
        arguments?: Record<string, unknown>;
        _delegateos?: DelegateOSMeta;
        [key: string]: unknown;
    };
}
/** MCP JSON-RPC 2.0 error response */
export interface MCPErrorResponse {
    jsonrpc: '2.0';
    id?: string | number;
    error: {
        code: number;
        message: string;
        data?: unknown;
    };
}
/** MCP JSON-RPC 2.0 success response */
export interface MCPResponse {
    jsonrpc: '2.0';
    id?: string | number;
    result?: unknown;
}
/** Proxy configuration for stdio transport */
export interface ProxyConfig {
    plugin: ReturnType<typeof import('./plugin.js').createMCPPlugin>;
    upstream: {
        command: string;
        args: string[];
    };
}
