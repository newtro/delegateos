/**
 * In-memory storage adapter for tests and simple use.
 */
import type { StorageAdapter, Delegation, DelegationFilter, Attestation, TrustProfile, RevocationEntry, TaskContract } from '../core/types.js';
export declare class MemoryStorageAdapter implements StorageAdapter {
    private delegations;
    private attestations;
    private trustProfiles;
    private revocations;
    private contracts;
    saveDelegation(delegation: Delegation): Promise<void>;
    getDelegation(id: string): Promise<Delegation | null>;
    listDelegations(filter?: DelegationFilter): Promise<Delegation[]>;
    saveAttestation(attestation: Attestation): Promise<void>;
    getAttestation(id: string): Promise<Attestation | null>;
    saveTrustProfile(profile: TrustProfile): Promise<void>;
    getTrustProfile(principalId: string): Promise<TrustProfile | null>;
    saveRevocation(entry: RevocationEntry): Promise<void>;
    getRevocations(): Promise<RevocationEntry[]>;
    saveContract(contract: TaskContract): Promise<void>;
    getContract(id: string): Promise<TaskContract | null>;
}
