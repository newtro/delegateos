/**
 * Delegation Chain — In-memory chain store for v0.1.
 */
import type { Delegation } from './types.js';
/** Chain store interface */
export interface ChainStore {
    put(delegation: Delegation): Promise<void>;
    get(delegationId: string): Promise<Delegation | null>;
    getChildren(delegationId: string): Promise<Delegation[]>;
    updateStatus(delegationId: string, status: Delegation['status'], attestationId?: string): Promise<void>;
}
/** In-memory implementation of ChainStore */
export declare class MemoryChainStore implements ChainStore {
    private delegations;
    /** Store a delegation */
    put(delegation: Delegation): Promise<void>;
    /** Retrieve a delegation by ID */
    get(delegationId: string): Promise<Delegation | null>;
    /** Get all child delegations of a parent */
    getChildren(delegationId: string): Promise<Delegation[]>;
    /** Update delegation status */
    updateStatus(delegationId: string, status: Delegation['status'], attestationId?: string): Promise<void>;
    /** Get the full chain from a delegation back to root */
    getChain(delegationId: string): Promise<Delegation[]>;
    /** Verify chain integrity (parent linkage, depth, from/to matching) */
    verifyChain(delegationId: string): Promise<{
        valid: boolean;
        error?: string;
    }>;
}
/** Generate a delegation ID */
export declare function generateDelegationId(): string;
