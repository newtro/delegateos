/**
 * Revocation List — In-memory revocation management for v0.1.
 */

import type { RevocationEntry, Result, Keypair } from './types.js';
import { signObject, verifyObjectSignature } from './crypto.js';

/** Revocation list interface */
export interface RevocationListInterface {
  isRevoked(revocationId: string): boolean;
  add(entry: RevocationEntry): Result<void, string>;
  list(): RevocationEntry[];
  getRevocationIds(): string[];
  toJSON(): string;
}

/** In-memory revocation list */
export class InMemoryRevocationList implements RevocationListInterface {
  private entries: Map<string, RevocationEntry> = new Map();

  /** Check if a revocation ID has been revoked */
  isRevoked(revocationId: string): boolean {
    return this.entries.has(revocationId);
  }

  /** Add a revocation entry (with signature verification) */
  add(entry: RevocationEntry): Result<void, string> {
    // Verify signature
    const { signature, ...toVerify } = entry;
    const valid = verifyObjectSignature(entry.revokedBy, toVerify, signature);
    if (!valid) {
      return { ok: false, error: 'Invalid revocation signature' };
    }
    this.entries.set(entry.revocationId, entry);
    return { ok: true, value: undefined };
  }

  /** Add without signature verification (for internal/testing use) */
  addUnchecked(entry: RevocationEntry): void {
    this.entries.set(entry.revocationId, entry);
  }

  /** List all active revocations */
  list(): RevocationEntry[] {
    return Array.from(this.entries.values());
  }

  /** Get all revocation IDs */
  getRevocationIds(): string[] {
    return Array.from(this.entries.keys());
  }

  /** Remove a revocation */
  remove(revocationId: string): boolean {
    return this.entries.delete(revocationId);
  }

  /** Serialize to JSON */
  toJSON(): string {
    return JSON.stringify(Array.from(this.entries.values()));
  }

  /** Load from JSON */
  static fromJSON(json: string): InMemoryRevocationList {
    const list = new InMemoryRevocationList();
    const entries = JSON.parse(json) as RevocationEntry[];
    for (const entry of entries) {
      list.entries.set(entry.revocationId, entry);
    }
    return list;
  }
}

/**
 * Create a signed revocation entry.
 * @param signer - Keypair of the revoker (must be the block signer)
 * @param revocationId - The revocation ID to revoke
 * @param scope - 'block' for single block, 'chain' for cascading
 * @returns Signed RevocationEntry
 */
export function createRevocationEntry(
  signer: Keypair,
  revocationId: string,
  scope: 'block' | 'chain' = 'block',
): RevocationEntry {
  const entry: RevocationEntry = {
    revocationId,
    revokedBy: signer.principal.id,
    revokedAt: new Date().toISOString(),
    scope,
    signature: '',
  };

  const { signature: _, ...toSign } = entry;
  entry.signature = signObject(signer.privateKey, toSign);

  return entry;
}

/**
 * Perform cascading revocation — revoke an entire chain of token IDs.
 * @param list - The revocation list to add to
 * @param signer - Keypair of the revoker
 * @param revocationIds - All revocation IDs in the chain
 */
export function cascadeRevoke(
  list: InMemoryRevocationList,
  signer: Keypair,
  revocationIds: string[],
): void {
  for (const id of revocationIds) {
    const entry = createRevocationEntry(signer, id, 'chain');
    list.add(entry);
  }
}
