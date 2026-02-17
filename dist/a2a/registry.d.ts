/**
 * Agent Registry — Registration, discovery, and verification of Agent Cards.
 */
import type { Result } from '../core/types.js';
import type { AgentCard, AgentFilter } from './types.js';
/**
 * In-memory Agent Card registry.
 * Validates card signatures on registration, supports filtered discovery.
 */
export declare class AgentRegistry {
    private cards;
    /**
     * Verify an agent card's self-signature.
     */
    verifyCard(card: AgentCard): Result<void>;
    /**
     * Register an agent card after validating its signature.
     */
    register(card: AgentCard): Result<void>;
    /**
     * Resolve an agent card by principal ID.
     */
    resolve(principalId: string): AgentCard | null;
    /**
     * Discover agents matching filter criteria.
     */
    discover(filter: AgentFilter): AgentCard[];
    /**
     * Remove an agent card.
     */
    unregister(principalId: string): boolean;
    /**
     * List all registered agent cards.
     */
    listAll(): AgentCard[];
}
