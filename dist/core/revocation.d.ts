/**
 * Revocation List — In-memory revocation management for v0.1.
 */
import type { RevocationEntry, Result, Keypair } from './types.js';
/** Revocation list interface */
export interface RevocationListInterface {
    isRevoked(revocationId: string): boolean;
    add(entry: RevocationEntry): Result<void, string>;
    list(): RevocationEntry[];
    getRevocationIds(): string[];
    toJSON(): string;
}
/** In-memory revocation list */
export declare class InMemoryRevocationList implements RevocationListInterface {
    private entries;
    /** Check if a revocation ID has been revoked */
    isRevoked(revocationId: string): boolean;
    /** Add a revocation entry (with signature verification) */
    add(entry: RevocationEntry): Result<void, string>;
    /** Add without signature verification (for internal/testing use) */
    addUnchecked(entry: RevocationEntry): void;
    /** List all active revocations */
    list(): RevocationEntry[];
    /** Get all revocation IDs */
    getRevocationIds(): string[];
    /** Remove a revocation */
    remove(revocationId: string): boolean;
    /** Serialize to JSON */
    toJSON(): string;
    /** Load from JSON */
    static fromJSON(json: string): InMemoryRevocationList;
}
/**
 * Create a signed revocation entry.
 * @param signer - Keypair of the revoker (must be the block signer)
 * @param revocationId - The revocation ID to revoke
 * @param scope - 'block' for single block, 'chain' for cascading
 * @returns Signed RevocationEntry
 */
export declare function createRevocationEntry(signer: Keypair, revocationId: string, scope?: 'block' | 'chain'): RevocationEntry;
/**
 * Perform cascading revocation — revoke an entire chain of token IDs.
 * @param list - The revocation list to add to
 * @param signer - Keypair of the revoker
 * @param revocationIds - All revocation IDs in the chain
 */
export declare function cascadeRevoke(list: InMemoryRevocationList, signer: Keypair, revocationIds: string[]): void;
