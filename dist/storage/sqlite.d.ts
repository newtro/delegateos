/**
 * SQLite storage adapter using better-sqlite3.
 */
import type { StorageAdapter, Delegation, DelegationFilter, Attestation, TrustProfile, RevocationEntry, TaskContract } from '../core/types.js';
export declare class SqliteStorageAdapter implements StorageAdapter {
    private db;
    private logger;
    constructor(dbPath?: string);
    private createTables;
    saveDelegation(d: Delegation): Promise<void>;
    getDelegation(id: string): Promise<Delegation | null>;
    listDelegations(filter?: DelegationFilter): Promise<Delegation[]>;
    saveAttestation(a: Attestation): Promise<void>;
    getAttestation(id: string): Promise<Attestation | null>;
    saveTrustProfile(p: TrustProfile): Promise<void>;
    getTrustProfile(principalId: string): Promise<TrustProfile | null>;
    saveRevocation(e: RevocationEntry): Promise<void>;
    getRevocations(): Promise<RevocationEntry[]>;
    saveContract(c: TaskContract): Promise<void>;
    getContract(id: string): Promise<TaskContract | null>;
    close(): void;
    private rowToDelegation;
}
