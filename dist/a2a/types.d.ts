/**
 * A2A Protocol Types — Agent-to-Agent protocol with Agent Card extensions.
 */
import type { Capability } from '../core/types.js';
/** Delegation policy for an agent */
export interface DelegationPolicy {
    acceptsDelegation: boolean;
    maxChainDepth: number;
    requiredTrustScore: number;
    allowedNamespaces: string[];
    costPerTaskMicrocents?: number;
}
/** Agent Card — self-describing agent identity and capabilities */
export interface AgentCard {
    id: string;
    name: string;
    description: string;
    /** Ed25519 public key (base64url) */
    principal: string;
    capabilities: Capability[];
    trustScore?: number;
    endpoint?: string;
    mcpServers?: string[];
    delegationPolicy: DelegationPolicy;
    metadata?: Record<string, string>;
    /** Self-signed by agent's Ed25519 key */
    signature: string;
}
/** Filter criteria for agent discovery */
export interface AgentFilter {
    capabilities?: Capability[];
    minTrustScore?: number;
    namespaces?: string[];
}
