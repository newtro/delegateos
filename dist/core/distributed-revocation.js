/**
 * Distributed Revocation — Upgrades from in-process revocation to a distributed system.
 * v0.2: simulates network with in-process message passing (no actual HTTP).
 */
import { InMemoryRevocationList } from './revocation.js';
import { verifyObjectSignature } from './crypto.js';
import { createLogger } from './logger.js';
import { globalMetrics } from './metrics.js';
// ── Local Revocation Store ──
/** Wraps the existing InMemoryRevocationList with the async RevocationStore interface */
export class LocalRevocationStore {
    inner;
    subscribers = new Set();
    constructor(inner) {
        this.inner = inner ?? new InMemoryRevocationList();
    }
    async revoke(entry) {
        const result = this.inner.add(entry);
        if (!result.ok) {
            throw new Error(result.error);
        }
        // Notify subscribers
        for (const cb of this.subscribers) {
            cb(entry);
        }
    }
    async isRevoked(delegationId) {
        return this.inner.isRevoked(delegationId);
    }
    async getRevocations(since) {
        const all = this.inner.list();
        if (!since)
            return all;
        return all.filter(e => e.revokedAt > since);
    }
    subscribe(callback) {
        this.subscribers.add(callback);
        return () => { this.subscribers.delete(callback); };
    }
    async sync() {
        // No-op for local store
    }
    /** Access the underlying revocation list */
    getInner() {
        return this.inner;
    }
}
const DEFAULT_CONFIG = {
    syncIntervalMs: 30_000,
    maxPeers: 50,
};
// ── Distributed Revocation Store ──
/**
 * Distributed revocation store with gossip-style sync.
 * For v0.2: simulates network with in-process message passing.
 */
export class DistributedRevocationStore {
    local;
    peers = new Map();
    config;
    subscribers = new Set();
    seen = new Set(); // deduplication by revocationId
    syncTimer = null;
    logger = createLogger('DistributedRevocation');
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.local = new LocalRevocationStore();
        // Populate seen set from local store
        for (const entry of this.local.getInner().list()) {
            this.seen.add(entry.revocationId);
        }
    }
    /** Add a peer for gossip sync (in-process simulation) */
    addPeer(peerId, endpoint, store) {
        if (this.peers.size >= this.config.maxPeers) {
            throw new Error(`Max peers (${this.config.maxPeers}) reached`);
        }
        this.peers.set(peerId, { peerId, endpoint, store });
    }
    /** Remove a peer */
    removePeer(peerId) {
        this.peers.delete(peerId);
    }
    /** Get connected peer IDs */
    getPeerIds() {
        return Array.from(this.peers.keys());
    }
    async revoke(entry) {
        // Verify signature
        const { signature, ...toVerify } = entry;
        const valid = verifyObjectSignature(entry.revokedBy, toVerify, signature);
        if (!valid) {
            throw new Error('Invalid revocation signature');
        }
        // Dedup
        if (this.seen.has(entry.revocationId))
            return;
        this.seen.add(entry.revocationId);
        // Store locally (use addUnchecked since we already verified)
        this.local.getInner().addUnchecked(entry);
        this.logger.info('Revocation stored and broadcasting', { revocationId: entry.revocationId });
        globalMetrics.counter('revocation.stored');
        // Notify local subscribers
        for (const cb of this.subscribers) {
            cb(entry);
        }
        // Broadcast to all peers (gossip)
        await this.broadcast(entry);
    }
    async isRevoked(delegationId) {
        return this.local.isRevoked(delegationId);
    }
    async getRevocations(since) {
        return this.local.getRevocations(since);
    }
    subscribe(callback) {
        this.subscribers.add(callback);
        return () => { this.subscribers.delete(callback); };
    }
    /** Pull missing entries from all peers (anti-entropy) */
    async sync() {
        for (const [, peer] of this.peers) {
            if (!peer.store)
                continue; // No in-process connection
            const peerEntries = await peer.store.getRevocations();
            for (const entry of peerEntries) {
                if (this.seen.has(entry.revocationId))
                    continue;
                // Verify signature
                const { signature, ...toVerify } = entry;
                const valid = verifyObjectSignature(entry.revokedBy, toVerify, signature);
                if (!valid)
                    continue; // Skip invalid entries
                this.seen.add(entry.revocationId);
                this.local.getInner().addUnchecked(entry);
                for (const cb of this.subscribers) {
                    cb(entry);
                }
            }
        }
    }
    /** Receive a revocation from a peer (called during broadcast) */
    async receiveFromPeer(entry) {
        if (this.seen.has(entry.revocationId))
            return;
        // Verify signature
        const { signature, ...toVerify } = entry;
        const valid = verifyObjectSignature(entry.revokedBy, toVerify, signature);
        if (!valid)
            return;
        this.seen.add(entry.revocationId);
        this.local.getInner().addUnchecked(entry);
        for (const cb of this.subscribers) {
            cb(entry);
        }
        // Continue gossiping (but peers won't re-broadcast due to dedup)
        await this.broadcast(entry);
    }
    /** Start periodic sync */
    startSync() {
        if (this.syncTimer)
            return;
        this.syncTimer = setInterval(() => this.sync(), this.config.syncIntervalMs);
    }
    /** Stop periodic sync */
    stopSync() {
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
            this.syncTimer = null;
        }
    }
    async broadcast(entry) {
        const promises = [];
        for (const [, peer] of this.peers) {
            if (peer.store) {
                promises.push(peer.store.receiveFromPeer(entry));
            }
        }
        await Promise.allSettled(promises);
    }
}
