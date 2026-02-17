/**
 * In-memory storage adapter for tests and simple use.
 */
export class MemoryStorageAdapter {
    delegations = new Map();
    attestations = new Map();
    trustProfiles = new Map();
    revocations = new Map();
    contracts = new Map();
    async saveDelegation(delegation) {
        this.delegations.set(delegation.id, { ...delegation });
    }
    async getDelegation(id) {
        return this.delegations.get(id) ?? null;
    }
    async listDelegations(filter) {
        let results = Array.from(this.delegations.values());
        if (filter) {
            if (filter.contractId)
                results = results.filter(d => d.contractId === filter.contractId);
            if (filter.from)
                results = results.filter(d => d.from === filter.from);
            if (filter.to)
                results = results.filter(d => d.to === filter.to);
            if (filter.status)
                results = results.filter(d => d.status === filter.status);
        }
        return results;
    }
    async saveAttestation(attestation) {
        this.attestations.set(attestation.id, { ...attestation });
    }
    async getAttestation(id) {
        return this.attestations.get(id) ?? null;
    }
    async saveTrustProfile(profile) {
        this.trustProfiles.set(profile.principalId, { ...profile });
    }
    async getTrustProfile(principalId) {
        return this.trustProfiles.get(principalId) ?? null;
    }
    async saveRevocation(entry) {
        this.revocations.set(entry.revocationId, { ...entry });
    }
    async getRevocations() {
        return Array.from(this.revocations.values());
    }
    async saveContract(contract) {
        this.contracts.set(contract.id, { ...contract });
    }
    async getContract(id) {
        return this.contracts.get(id) ?? null;
    }
}
