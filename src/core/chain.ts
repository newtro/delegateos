/**
 * Delegation Chain — In-memory chain store for v0.1.
 */

import type { Delegation, SerializedDCT } from './types.js';

/** Chain store interface */
export interface ChainStore {
  put(delegation: Delegation): Promise<void>;
  get(delegationId: string): Promise<Delegation | null>;
  getChildren(delegationId: string): Promise<Delegation[]>;
  updateStatus(delegationId: string, status: Delegation['status'], attestationId?: string): Promise<void>;
}

/** In-memory implementation of ChainStore */
export class MemoryChainStore implements ChainStore {
  private delegations: Map<string, Delegation> = new Map();

  /** Store a delegation */
  async put(delegation: Delegation): Promise<void> {
    this.delegations.set(delegation.id, { ...delegation });
  }

  /** Retrieve a delegation by ID */
  async get(delegationId: string): Promise<Delegation | null> {
    return this.delegations.get(delegationId) ?? null;
  }

  /** Get all child delegations of a parent */
  async getChildren(delegationId: string): Promise<Delegation[]> {
    const children: Delegation[] = [];
    for (const d of this.delegations.values()) {
      if (d.parentId === delegationId) {
        children.push({ ...d });
      }
    }
    return children;
  }

  /** Update delegation status */
  async updateStatus(delegationId: string, status: Delegation['status'], attestationId?: string): Promise<void> {
    const d = this.delegations.get(delegationId);
    if (!d) throw new Error(`Delegation not found: ${delegationId}`);
    d.status = status;
    if (attestationId) d.attestationId = attestationId;
    if (status === 'completed' || status === 'failed') {
      d.completedAt = new Date().toISOString();
    }
  }

  /** Get the full chain from a delegation back to root */
  async getChain(delegationId: string): Promise<Delegation[]> {
    const chain: Delegation[] = [];
    let current = await this.get(delegationId);
    while (current) {
      chain.unshift(current);
      if (current.parentId === 'del_000000000000') break;
      current = await this.get(current.parentId);
    }
    return chain;
  }

  /** Verify chain integrity (parent linkage, depth, from/to matching) */
  async verifyChain(delegationId: string): Promise<{ valid: boolean; error?: string }> {
    const chain = await this.getChain(delegationId);
    if (chain.length === 0) return { valid: false, error: 'Empty chain' };

    // Root check
    if (chain[0].parentId !== 'del_000000000000' || chain[0].depth !== 0) {
      return { valid: false, error: 'Invalid root delegation' };
    }

    for (let i = 1; i < chain.length; i++) {
      const parent = chain[i - 1];
      const child = chain[i];
      if (child.parentId !== parent.id) {
        return { valid: false, error: `Broken parent link at depth ${i}` };
      }
      if (child.from !== parent.to) {
        return { valid: false, error: `Delegator mismatch at depth ${i}` };
      }
      if (child.depth !== parent.depth + 1) {
        return { valid: false, error: `Depth mismatch at depth ${i}` };
      }
    }

    return { valid: true };
  }
}

/** Generate a delegation ID */
export function generateDelegationId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `del_${hex}`;
}
