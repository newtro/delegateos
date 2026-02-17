/**
 * Delegation Broker — Discovers agents and brokers delegations via the A2A protocol.
 */
import { createDCT } from '../core/dct.js';
import { generateDelegationId } from '../core/chain.js';
import { createCompletionAttestation } from '../core/attestation.js';
import { createLogger } from '../core/logger.js';
import { globalMetrics } from '../core/metrics.js';
/**
 * Brokers delegations between agents using the registry and trust engine.
 */
export class DelegationBroker {
    registry;
    trustEngine;
    logger = createLogger('DelegationBroker');
    constructor(registry, trustEngine) {
        this.registry = registry;
        this.trustEngine = trustEngine;
    }
    /**
     * Find the best agent for a task based on capabilities, trust, and cost.
     */
    findAgent(contract, chain) {
        // Build required capabilities from contract constraints
        const requiredCaps = contract.constraints.requiredCapabilities.map(ns => ({
            namespace: ns,
            action: '*',
            resource: '*',
        }));
        // Discover matching agents
        const candidates = this.registry.discover({
            capabilities: requiredCaps.length > 0 ? requiredCaps : undefined,
        });
        if (candidates.length === 0) {
            this.logger.warn('No agents found', { contractId: contract.id });
            return { ok: false, error: new Error('No agents found matching contract requirements') };
        }
        // Filter by delegation policy
        const chainDepth = chain ? chain.length : 0;
        const eligible = candidates.filter(card => {
            if (!card.delegationPolicy.acceptsDelegation)
                return false;
            if (card.delegationPolicy.maxChainDepth < chainDepth + 1)
                return false;
            // Check trust threshold
            const score = this.trustEngine.getScore(card.principal);
            if (score.composite < card.delegationPolicy.requiredTrustScore)
                return false;
            // Check cost
            if (card.delegationPolicy.costPerTaskMicrocents !== undefined &&
                card.delegationPolicy.costPerTaskMicrocents > contract.constraints.maxBudgetMicrocents) {
                return false;
            }
            return true;
        });
        if (eligible.length === 0) {
            return { ok: false, error: new Error('No eligible agents after policy filtering') };
        }
        // Score and rank: composite trust score (higher = better), cost (lower = better)
        const scored = eligible.map(card => {
            const trust = this.trustEngine.getScore(card.principal);
            const costPenalty = card.delegationPolicy.costPerTaskMicrocents
                ? card.delegationPolicy.costPerTaskMicrocents / contract.constraints.maxBudgetMicrocents
                : 0;
            const rank = trust.composite * 0.7 + (1 - costPenalty) * 0.3;
            return { card, rank };
        });
        scored.sort((a, b) => b.rank - a.rank);
        this.logger.info('Agent selected', { principal: scored[0].card.principal, rank: scored[0].rank });
        globalMetrics.counter('broker.agents_found');
        return { ok: true, value: scored[0].card };
    }
    /**
     * Propose a delegation from one agent to another.
     * Creates a DCT and delegation record.
     */
    proposeDelegation(from, to, contract) {
        // Verify the target agent accepts delegation
        if (!to.delegationPolicy.acceptsDelegation) {
            return { ok: false, error: new Error('Target agent does not accept delegations') };
        }
        const delegationId = generateDelegationId();
        // Create DCT
        const capabilities = contract.constraints.requiredCapabilities.map(ns => ({
            namespace: ns,
            action: '*',
            resource: '**',
        }));
        const dct = createDCT({
            issuer: from,
            delegatee: { id: to.principal },
            capabilities: capabilities.length > 0 ? capabilities : [{ namespace: '*', action: '*', resource: '**' }],
            contractId: contract.id,
            delegationId,
            parentDelegationId: 'del_000000000000',
            chainDepth: 0,
            maxChainDepth: Math.min(contract.constraints.maxChainDepth, to.delegationPolicy.maxChainDepth),
            maxBudgetMicrocents: contract.constraints.maxBudgetMicrocents,
            expiresAt: contract.constraints.deadline,
        });
        const delegation = {
            id: delegationId,
            parentId: 'del_000000000000',
            from: from.principal.id,
            to: to.principal,
            contractId: contract.id,
            dct,
            depth: 0,
            status: 'active',
            createdAt: new Date().toISOString(),
        };
        this.logger.info('Delegation proposed', { delegationId, to: to.principal });
        globalMetrics.counter('broker.delegations_proposed');
        return { ok: true, value: { dct, delegation } };
    }
    /**
     * Accept a delegation and return a completion attestation.
     */
    acceptDelegation(agent, delegation, result) {
        if (delegation.to !== agent.principal.id) {
            return { ok: false, error: new Error('Agent is not the delegation target') };
        }
        if (delegation.status !== 'active') {
            return { ok: false, error: new Error(`Delegation is not active (status: ${delegation.status})`) };
        }
        const attestation = createCompletionAttestation(agent, delegation.contractId, delegation.id, result);
        return { ok: true, value: attestation };
    }
}
