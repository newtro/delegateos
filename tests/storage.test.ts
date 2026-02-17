import { describe, it, expect } from 'vitest';
import { MemoryStorageAdapter } from '../src/storage/memory.js';
import { SqliteStorageAdapter } from '../src/storage/sqlite.js';
import type { Delegation, Attestation, TrustProfile, RevocationEntry, TaskContract, StorageAdapter } from '../src/core/types.js';

function makeDelegation(id: string, overrides: Partial<Delegation> = {}): Delegation {
  return {
    id,
    parentId: 'del_000000000000',
    from: 'alice',
    to: 'bob',
    contractId: 'ct_1',
    dct: { token: 'abc', format: 'delegateos-sjt-v1' },
    depth: 0,
    status: 'active',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAttestation(id: string): Attestation {
  return {
    id,
    version: '0.1',
    contractId: 'ct_1',
    delegationId: 'del_1',
    principal: 'bob',
    createdAt: new Date().toISOString(),
    type: 'completion',
    result: { success: true, costMicrocents: 100, durationMs: 500 },
    childAttestations: [],
    signature: 'sig',
  };
}

function makeContract(id: string): TaskContract {
  return {
    id,
    version: '0.1',
    issuer: 'alice',
    createdAt: new Date().toISOString(),
    task: { title: 'Test', description: 'test', inputs: {}, outputSchema: {} },
    verification: { method: 'schema_match', schema: { type: 'object' } },
    constraints: { maxBudgetMicrocents: 1000, deadline: new Date().toISOString(), maxChainDepth: 3, requiredCapabilities: ['web'] },
    signature: 'sig',
  };
}

function runStorageTests(name: string, createAdapter: () => StorageAdapter) {
  describe(name, () => {
    it('saves and retrieves delegation', async () => {
      const adapter = createAdapter();
      const del = makeDelegation('del_1');
      await adapter.saveDelegation(del);
      const got = await adapter.getDelegation('del_1');
      expect(got).not.toBeNull();
      expect(got!.id).toBe('del_1');
      expect(got!.from).toBe('alice');
    });

    it('returns null for missing delegation', async () => {
      const adapter = createAdapter();
      expect(await adapter.getDelegation('nonexistent')).toBeNull();
    });

    it('lists delegations with filter', async () => {
      const adapter = createAdapter();
      await adapter.saveDelegation(makeDelegation('del_1', { contractId: 'ct_a', status: 'active' }));
      await adapter.saveDelegation(makeDelegation('del_2', { contractId: 'ct_b', status: 'completed' }));
      await adapter.saveDelegation(makeDelegation('del_3', { contractId: 'ct_a', status: 'completed' }));

      expect(await adapter.listDelegations({ contractId: 'ct_a' })).toHaveLength(2);
      expect(await adapter.listDelegations({ status: 'completed' })).toHaveLength(2);
      expect(await adapter.listDelegations({ contractId: 'ct_a', status: 'completed' })).toHaveLength(1);
      expect(await adapter.listDelegations()).toHaveLength(3);
    });

    it('saves and retrieves attestation', async () => {
      const adapter = createAdapter();
      await adapter.saveAttestation(makeAttestation('att_1'));
      const got = await adapter.getAttestation('att_1');
      expect(got).not.toBeNull();
      expect(got!.result.success).toBe(true);
    });

    it('returns null for missing attestation', async () => {
      const adapter = createAdapter();
      expect(await adapter.getAttestation('nonexistent')).toBeNull();
    });

    it('saves and retrieves trust profile', async () => {
      const adapter = createAdapter();
      const profile: TrustProfile = {
        principalId: 'bob',
        outcomes: [{ timestamp: new Date().toISOString(), success: true, qualityScore: 0.9, durationMs: 1000, contractId: 'ct_1', attestationId: 'att_1' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await adapter.saveTrustProfile(profile);
      const got = await adapter.getTrustProfile('bob');
      expect(got).not.toBeNull();
      expect(got!.outcomes).toHaveLength(1);
    });

    it('saves and retrieves revocations', async () => {
      const adapter = createAdapter();
      const rev: RevocationEntry = {
        revocationId: 'rev_1',
        revokedBy: 'alice',
        revokedAt: new Date().toISOString(),
        scope: 'block',
        signature: 'sig',
      };
      await adapter.saveRevocation(rev);
      const revs = await adapter.getRevocations();
      expect(revs).toHaveLength(1);
      expect(revs[0].revocationId).toBe('rev_1');
    });

    it('saves and retrieves contract', async () => {
      const adapter = createAdapter();
      await adapter.saveContract(makeContract('ct_1'));
      const got = await adapter.getContract('ct_1');
      expect(got).not.toBeNull();
      expect(got!.task.title).toBe('Test');
    });

    it('returns null for missing contract', async () => {
      const adapter = createAdapter();
      expect(await adapter.getContract('nonexistent')).toBeNull();
    });

    it('overwrites on duplicate save', async () => {
      const adapter = createAdapter();
      await adapter.saveDelegation(makeDelegation('del_1', { status: 'active' }));
      await adapter.saveDelegation(makeDelegation('del_1', { status: 'completed' }));
      const got = await adapter.getDelegation('del_1');
      expect(got!.status).toBe('completed');
    });
  });
}

runStorageTests('MemoryStorageAdapter', () => new MemoryStorageAdapter());
runStorageTests('SqliteStorageAdapter', () => new SqliteStorageAdapter(':memory:'));
