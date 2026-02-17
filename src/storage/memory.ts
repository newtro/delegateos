/**
 * In-memory storage adapter for tests and simple use.
 */

import type {
  StorageAdapter,
  Delegation,
  DelegationFilter,
  Attestation,
  TrustProfile,
  RevocationEntry,
  TaskContract,
} from '../core/types.js';

export class MemoryStorageAdapter implements StorageAdapter {
  private delegations = new Map<string, Delegation>();
  private attestations = new Map<string, Attestation>();
  private trustProfiles = new Map<string, TrustProfile>();
  private revocations = new Map<string, RevocationEntry>();
  private contracts = new Map<string, TaskContract>();

  async saveDelegation(delegation: Delegation): Promise<void> {
    this.delegations.set(delegation.id, { ...delegation });
  }

  async getDelegation(id: string): Promise<Delegation | null> {
    return this.delegations.get(id) ?? null;
  }

  async listDelegations(filter?: DelegationFilter): Promise<Delegation[]> {
    let results = Array.from(this.delegations.values());
    if (filter) {
      if (filter.contractId) results = results.filter(d => d.contractId === filter.contractId);
      if (filter.from) results = results.filter(d => d.from === filter.from);
      if (filter.to) results = results.filter(d => d.to === filter.to);
      if (filter.status) results = results.filter(d => d.status === filter.status);
    }
    return results;
  }

  async saveAttestation(attestation: Attestation): Promise<void> {
    this.attestations.set(attestation.id, { ...attestation });
  }

  async getAttestation(id: string): Promise<Attestation | null> {
    return this.attestations.get(id) ?? null;
  }

  async saveTrustProfile(profile: TrustProfile): Promise<void> {
    this.trustProfiles.set(profile.principalId, { ...profile });
  }

  async getTrustProfile(principalId: string): Promise<TrustProfile | null> {
    return this.trustProfiles.get(principalId) ?? null;
  }

  async saveRevocation(entry: RevocationEntry): Promise<void> {
    this.revocations.set(entry.revocationId, { ...entry });
  }

  async getRevocations(): Promise<RevocationEntry[]> {
    return Array.from(this.revocations.values());
  }

  async saveContract(contract: TaskContract): Promise<void> {
    this.contracts.set(contract.id, { ...contract });
  }

  async getContract(id: string): Promise<TaskContract | null> {
    return this.contracts.get(id) ?? null;
  }
}
