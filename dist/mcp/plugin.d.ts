import type { RevocationEntry } from '../core/types.js';
import type { MCPPluginConfig, MCPRequest, MCPErrorResponse } from './types.js';
import { AuditLog } from './audit.js';
export declare function createMCPPlugin(config: MCPPluginConfig): {
    handleRequest: (req: MCPRequest) => Promise<MCPRequest | MCPErrorResponse>;
    handleResponse: (req: MCPRequest, res: unknown) => Promise<unknown>;
    addRevocation: (entry: RevocationEntry) => void;
    getAuditLog: () => AuditLog;
};
export type MCPPlugin = ReturnType<typeof createMCPPlugin>;
