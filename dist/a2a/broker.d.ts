/**
 * Delegation Broker — Discovers agents and brokers delegations via the A2A protocol.
 */
import type { Result, Keypair, TaskContract, Delegation, Attestation, AttestationResult, SerializedDCT } from '../core/types.js';
import type { AgentCard } from './types.js';
import { AgentRegistry } from './registry.js';
import { TrustEngine } from '../core/trust.js';
/**
 * Brokers delegations between agents using the registry and trust engine.
 */
export declare class DelegationBroker {
    private registry;
    private trustEngine;
    private logger;
    constructor(registry: AgentRegistry, trustEngine: TrustEngine);
    /**
     * Find the best agent for a task based on capabilities, trust, and cost.
     */
    findAgent(contract: TaskContract, chain?: Delegation[]): Result<AgentCard>;
    /**
     * Propose a delegation from one agent to another.
     * Creates a DCT and delegation record.
     */
    proposeDelegation(from: Keypair, to: AgentCard, contract: TaskContract): Result<{
        dct: SerializedDCT;
        delegation: Delegation;
    }>;
    /**
     * Accept a delegation and return a completion attestation.
     */
    acceptDelegation(agent: Keypair, delegation: Delegation, result: AttestationResult): Result<Attestation>;
}
