/**
 * Revocation List — In-memory revocation management for v0.1.
 */
import { signObject, verifyObjectSignature } from './crypto.js';
/** In-memory revocation list */
export class InMemoryRevocationList {
    entries = new Map();
    /** Check if a revocation ID has been revoked */
    isRevoked(revocationId) {
        return this.entries.has(revocationId);
    }
    /** Add a revocation entry (with signature verification) */
    add(entry) {
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
    addUnchecked(entry) {
        this.entries.set(entry.revocationId, entry);
    }
    /** List all active revocations */
    list() {
        return Array.from(this.entries.values());
    }
    /** Get all revocation IDs */
    getRevocationIds() {
        return Array.from(this.entries.keys());
    }
    /** Remove a revocation */
    remove(revocationId) {
        return this.entries.delete(revocationId);
    }
    /** Serialize to JSON */
    toJSON() {
        return JSON.stringify(Array.from(this.entries.values()));
    }
    /** Load from JSON */
    static fromJSON(json) {
        const list = new InMemoryRevocationList();
        const entries = JSON.parse(json);
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
export function createRevocationEntry(signer, revocationId, scope = 'block') {
    const entry = {
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
export function cascadeRevoke(list, signer, revocationIds) {
    for (const id of revocationIds) {
        const entry = createRevocationEntry(signer, id, 'chain');
        list.add(entry);
    }
}
