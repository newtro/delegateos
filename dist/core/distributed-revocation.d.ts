/**
 * Distributed Revocation — Upgrades from in-process revocation to a distributed system.
 * v0.2: simulates network with in-process message passing (no actual HTTP).
 */
import type { RevocationEntry } from './types.js';
import { InMemoryRevocationList } from './revocation.js';
/** Async revocation store interface for distributed revocation */
export interface RevocationStore {
    revoke(entry: RevocationEntry): Promise<void>;
    isRevoked(delegationId: string): Promise<boolean>;
    getRevocations(since?: string): Promise<RevocationEntry[]>;
    subscribe(callback: (entry: RevocationEntry) => void): () => void;
    sync(): Promise<void>;
}
/** Wraps the existing InMemoryRevocationList with the async RevocationStore interface */
export declare class LocalRevocationStore implements RevocationStore {
    private inner;
    private subscribers;
    constructor(inner?: InMemoryRevocationList);
    revoke(entry: RevocationEntry): Promise<void>;
    isRevoked(delegationId: string): Promise<boolean>;
    getRevocations(since?: string): Promise<RevocationEntry[]>;
    subscribe(callback: (entry: RevocationEntry) => void): () => void;
    sync(): Promise<void>;
    /** Access the underlying revocation list */
    getInner(): InMemoryRevocationList;
}
export interface DistributedRevocationConfig {
    syncIntervalMs: number;
    maxPeers: number;
}
/**
 * Distributed revocation store with gossip-style sync.
 * For v0.2: simulates network with in-process message passing.
 */
export declare class DistributedRevocationStore implements RevocationStore {
    private local;
    private peers;
    private config;
    private subscribers;
    private seen;
    private syncTimer;
    private logger;
    constructor(config?: Partial<DistributedRevocationConfig>);
    /** Add a peer for gossip sync (in-process simulation) */
    addPeer(peerId: string, endpoint: string, store?: DistributedRevocationStore): void;
    /** Remove a peer */
    removePeer(peerId: string): void;
    /** Get connected peer IDs */
    getPeerIds(): string[];
    revoke(entry: RevocationEntry): Promise<void>;
    isRevoked(delegationId: string): Promise<boolean>;
    getRevocations(since?: string): Promise<RevocationEntry[]>;
    subscribe(callback: (entry: RevocationEntry) => void): () => void;
    /** Pull missing entries from all peers (anti-entropy) */
    sync(): Promise<void>;
    /** Receive a revocation from a peer (called during broadcast) */
    receiveFromPeer(entry: RevocationEntry): Promise<void>;
    /** Start periodic sync */
    startSync(): void;
    /** Stop periodic sync */
    stopSync(): void;
    private broadcast;
}
