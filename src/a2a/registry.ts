/**
 * Agent Registry — Registration, discovery, and verification of Agent Cards.
 */

import type { Result, Capability } from '../core/types.js';
import type { AgentCard, AgentFilter } from './types.js';
import { verifyObjectSignature } from '../core/crypto.js';

/**
 * In-memory Agent Card registry.
 * Validates card signatures on registration, supports filtered discovery.
 */
export class AgentRegistry {
  private cards: Map<string, AgentCard> = new Map();

  /**
   * Verify an agent card's self-signature.
   */
  verifyCard(card: AgentCard): Result<void> {
    const { signature, ...toVerify } = card;
    const valid = verifyObjectSignature(card.principal, toVerify, signature);
    if (!valid) {
      return { ok: false, error: new Error('Invalid agent card signature') };
    }
    return { ok: true, value: undefined };
  }

  /**
   * Register an agent card after validating its signature.
   */
  register(card: AgentCard): Result<void> {
    const verifyResult = this.verifyCard(card);
    if (!verifyResult.ok) return verifyResult;

    this.cards.set(card.principal, card);
    return { ok: true, value: undefined };
  }

  /**
   * Resolve an agent card by principal ID.
   */
  resolve(principalId: string): AgentCard | null {
    return this.cards.get(principalId) ?? null;
  }

  /**
   * Discover agents matching filter criteria.
   */
  discover(filter: AgentFilter): AgentCard[] {
    let results = Array.from(this.cards.values());

    if (filter.minTrustScore !== undefined) {
      results = results.filter(c => (c.trustScore ?? 0) >= filter.minTrustScore!);
    }

    if (filter.namespaces && filter.namespaces.length > 0) {
      results = results.filter(card =>
        filter.namespaces!.some(ns =>
          card.delegationPolicy.allowedNamespaces.includes(ns) ||
          card.capabilities.some(c => c.namespace === ns)
        )
      );
    }

    if (filter.capabilities && filter.capabilities.length > 0) {
      results = results.filter(card =>
        filter.capabilities!.every(reqCap =>
          card.capabilities.some(agentCap =>
            agentCap.namespace === reqCap.namespace &&
            (agentCap.action === reqCap.action || agentCap.action === '*') &&
            (agentCap.resource === '*' || agentCap.resource === '**' || agentCap.resource === reqCap.resource)
          )
        )
      );
    }

    return results;
  }

  /**
   * Remove an agent card.
   */
  unregister(principalId: string): boolean {
    return this.cards.delete(principalId);
  }

  /**
   * List all registered agent cards.
   */
  listAll(): AgentCard[] {
    return Array.from(this.cards.values());
  }
}
