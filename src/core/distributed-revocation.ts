/**
 * Distributed Revocation — Upgrades from in-process revocation to a distributed system.
 * v0.2: simulates network with in-process message passing (no actual HTTP).
 */

import type { RevocationEntry, Result, Keypair } from './types.js';
import { InMemoryRevocationList, createRevocationEntry } from './revocation.js';
import { verifyObjectSignature } from './crypto.js';

// ── RevocationStore Interface ──

/** Async revocation store interface for distributed revocation */
export interface RevocationStore {
  revoke(entry: RevocationEntry): Promise<void>;
  isRevoked(delegationId: string): Promise<boolean>;
  getRevocations(since?: string): Promise<RevocationEntry[]>;
  subscribe(callback: (entry: RevocationEntry) => void): () => void;
  sync(): Promise<void>;
}

// ── Local Revocation Store ──

/** Wraps the existing InMemoryRevocationList with the async RevocationStore interface */
export class LocalRevocationStore implements RevocationStore {
  private inner: InMemoryRevocationList;
  private subscribers: Set<(entry: RevocationEntry) => void> = new Set();

  constructor(inner?: InMemoryRevocationList) {
    this.inner = inner ?? new InMemoryRevocationList();
  }

  async revoke(entry: RevocationEntry): Promise<void> {
    const result = this.inner.add(entry);
    if (!result.ok) {
      throw new Error(result.error);
    }
    // Notify subscribers
    for (const cb of this.subscribers) {
      cb(entry);
    }
  }

  async isRevoked(delegationId: string): Promise<boolean> {
    return this.inner.isRevoked(delegationId);
  }

  async getRevocations(since?: string): Promise<RevocationEntry[]> {
    const all = this.inner.list();
    if (!since) return all;
    return all.filter(e => e.revokedAt > since);
  }

  subscribe(callback: (entry: RevocationEntry) => void): () => void {
    this.subscribers.add(callback);
    return () => { this.subscribers.delete(callback); };
  }

  async sync(): Promise<void> {
    // No-op for local store
  }

  /** Access the underlying revocation list */
  getInner(): InMemoryRevocationList {
    return this.inner;
  }
}

// ── Distributed Revocation Store Config ──

export interface DistributedRevocationConfig {
  syncIntervalMs: number;
  maxPeers: number;
}

const DEFAULT_CONFIG: DistributedRevocationConfig = {
  syncIntervalMs: 30_000,
  maxPeers: 50,
};

// ── Peer Transport (in-process simulation) ──

interface PeerConnection {
  peerId: string;
  endpoint: string;
  /** For v0.2: direct reference to peer store for in-process simulation */
  store?: DistributedRevocationStore;
}

// ── Distributed Revocation Store ──

/**
 * Distributed revocation store with gossip-style sync.
 * For v0.2: simulates network with in-process message passing.
 */
export class DistributedRevocationStore implements RevocationStore {
  private local: LocalRevocationStore;
  private peers: Map<string, PeerConnection> = new Map();
  private config: DistributedRevocationConfig;
  private subscribers: Set<(entry: RevocationEntry) => void> = new Set();
  private seen: Set<string> = new Set(); // deduplication by revocationId
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<DistributedRevocationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.local = new LocalRevocationStore();

    // Populate seen set from local store
    for (const entry of this.local.getInner().list()) {
      this.seen.add(entry.revocationId);
    }
  }

  /** Add a peer for gossip sync (in-process simulation) */
  addPeer(peerId: string, endpoint: string, store?: DistributedRevocationStore): void {
    if (this.peers.size >= this.config.maxPeers) {
      throw new Error(`Max peers (${this.config.maxPeers}) reached`);
    }
    this.peers.set(peerId, { peerId, endpoint, store });
  }

  /** Remove a peer */
  removePeer(peerId: string): void {
    this.peers.delete(peerId);
  }

  /** Get connected peer IDs */
  getPeerIds(): string[] {
    return Array.from(this.peers.keys());
  }

  async revoke(entry: RevocationEntry): Promise<void> {
    // Verify signature
    const { signature, ...toVerify } = entry;
    const valid = verifyObjectSignature(entry.revokedBy, toVerify, signature);
    if (!valid) {
      throw new Error('Invalid revocation signature');
    }

    // Dedup
    if (this.seen.has(entry.revocationId)) return;
    this.seen.add(entry.revocationId);

    // Store locally (use addUnchecked since we already verified)
    this.local.getInner().addUnchecked(entry);

    // Notify local subscribers
    for (const cb of this.subscribers) {
      cb(entry);
    }

    // Broadcast to all peers (gossip)
    await this.broadcast(entry);
  }

  async isRevoked(delegationId: string): Promise<boolean> {
    return this.local.isRevoked(delegationId);
  }

  async getRevocations(since?: string): Promise<RevocationEntry[]> {
    return this.local.getRevocations(since);
  }

  subscribe(callback: (entry: RevocationEntry) => void): () => void {
    this.subscribers.add(callback);
    return () => { this.subscribers.delete(callback); };
  }

  /** Pull missing entries from all peers (anti-entropy) */
  async sync(): Promise<void> {
    for (const [, peer] of this.peers) {
      if (!peer.store) continue; // No in-process connection

      const peerEntries = await peer.store.getRevocations();
      for (const entry of peerEntries) {
        if (this.seen.has(entry.revocationId)) continue;

        // Verify signature
        const { signature, ...toVerify } = entry;
        const valid = verifyObjectSignature(entry.revokedBy, toVerify, signature);
        if (!valid) continue; // Skip invalid entries

        this.seen.add(entry.revocationId);
        this.local.getInner().addUnchecked(entry);

        for (const cb of this.subscribers) {
          cb(entry);
        }
      }
    }
  }

  /** Receive a revocation from a peer (called during broadcast) */
  async receiveFromPeer(entry: RevocationEntry): Promise<void> {
    if (this.seen.has(entry.revocationId)) return;

    // Verify signature
    const { signature, ...toVerify } = entry;
    const valid = verifyObjectSignature(entry.revokedBy, toVerify, signature);
    if (!valid) return;

    this.seen.add(entry.revocationId);
    this.local.getInner().addUnchecked(entry);

    for (const cb of this.subscribers) {
      cb(entry);
    }

    // Continue gossiping (but peers won't re-broadcast due to dedup)
    await this.broadcast(entry);
  }

  /** Start periodic sync */
  startSync(): void {
    if (this.syncTimer) return;
    this.syncTimer = setInterval(() => this.sync(), this.config.syncIntervalMs);
  }

  /** Stop periodic sync */
  stopSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  private async broadcast(entry: RevocationEntry): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [, peer] of this.peers) {
      if (peer.store) {
        promises.push(peer.store.receiveFromPeer(entry));
      }
    }
    await Promise.allSettled(promises);
  }
}
