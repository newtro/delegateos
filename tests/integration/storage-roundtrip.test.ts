/**
 * Integration tests — Storage roundtrip: full lifecycle through both adapters.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { MemoryStorageAdapter } from '../../src/storage/memory.js';
import { SqliteStorageAdapter } from '../../src/storage/sqlite.js';
import { generateKeypair } from '../../src/core/crypto.js';
import { createDCT } from '../../src/core/dct.js';
import { createContract } from '../../src/core/contract.js';
import { createCompletionAttestation } from '../../src/core/attestation.js';
import { createRevocationEntry } from '../../src/core/revocation.js';
import { generateDelegationId } from '../../src/core/chain.js';
import type { StorageAdapter, Delegation, TrustProfile } from '../../src/core/types.js';

function futureISO(hours = 1): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

const SQLITE_PATH = '/tmp/delegateos-integration-test.db';

afterAll(() => {
  try { if (existsSync(SQLITE_PATH)) unlinkSync(SQLITE_PATH); } catch { /* ignore */ }
});

function runStorageRoundtrip(name: string, createAdapter: () => StorageAdapter) {
  describe(name, () => {
    const orchestrator = generateKeypair('Orchestrator');
    const agent = generateKeypair('Agent');

    it('full lifecycle: contract → delegation → attestation → retrieve', async () => {
      const adapter = createAdapter();

      // Create contract
      const contract = createContract(
        orchestrator,
        { title: 'Integration Test', description: 'Full roundtrip', inputs: { code: 'main.ts' }, outputSchema: { type: 'object' } },
        { method: 'schema_match', schema: { type: 'object' } },
        { maxBudgetMicrocents: 5000, deadline: futureISO(2), maxChainDepth: 3, requiredCapabilities: ['code'] },
      );

      await adapter.saveContract(contract);
      const retrievedContract = await adapter.getContract(contract.id);
      expect(retrievedContract).not.toBeNull();
      expect(retrievedContract!.id).toBe(contract.id);
      expect(retrievedContract!.task.title).toBe('Integration Test');

      // Create delegation with DCT
      const delegationId = generateDelegationId();
      const dct = createDCT({
        issuer: orchestrator,
        delegatee: agent.principal,
        capabilities: [{ namespace: 'code', action: '*', resource: '**' }],
        contractId: contract.id,
        delegationId,
        parentDelegationId: 'del_root',
        chainDepth: 0,
        maxChainDepth: 3,
        maxBudgetMicrocents: 5000,
        expiresAt: futureISO(1),
      });

      const delegation: Delegation = {
        id: delegationId,
        parentId: 'del_root',
        from: orchestrator.principal.id,
        to: agent.principal.id,
        contractId: contract.id,
        dct,
        depth: 0,
        status: 'active',
        createdAt: new Date().toISOString(),
      };

      await adapter.saveDelegation(delegation);
      const retrievedDel = await adapter.getDelegation(delegationId);
      expect(retrievedDel).not.toBeNull();
      expect(retrievedDel!.from).toBe(orchestrator.principal.id);
      expect(retrievedDel!.to).toBe(agent.principal.id);
      expect(retrievedDel!.dct.format).toBe('delegateos-sjt-v1');

      // Create attestation
      const attestation = createCompletionAttestation(agent, contract.id, delegationId, {
        success: true,
        output: { reviewed: true, score: 95 },
        costMicrocents: 300,
        durationMs: 1500,
      });

      await adapter.saveAttestation(attestation);
      const retrievedAtt = await adapter.getAttestation(attestation.id);
      expect(retrievedAtt).not.toBeNull();
      expect(retrievedAtt!.result.success).toBe(true);
      expect(retrievedAtt!.result.costMicrocents).toBe(300);

      // List delegations by contract
      const delegations = await adapter.listDelegations({ contractId: contract.id });
      expect(delegations.length).toBe(1);
      expect(delegations[0].id).toBe(delegationId);
    });

    it('saves and retrieves trust profile', async () => {
      const adapter = createAdapter();

      const profile: TrustProfile = {
        principalId: agent.principal.id,
        outcomes: [
          { timestamp: new Date().toISOString(), success: true, qualityScore: 0.9, durationMs: 1000, contractId: 'ct_1', attestationId: 'att_1' },
          { timestamp: new Date().toISOString(), success: true, qualityScore: 0.8, durationMs: 800, contractId: 'ct_2', attestationId: 'att_2' },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.saveTrustProfile(profile);
      const retrieved = await adapter.getTrustProfile(agent.principal.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.outcomes).toHaveLength(2);
      expect(retrieved!.outcomes[0].qualityScore).toBe(0.9);
    });

    it('saves and retrieves revocation entries', async () => {
      const adapter = createAdapter();

      const entry = createRevocationEntry(orchestrator, 'rev_test_001', 'chain');
      await adapter.saveRevocation(entry);

      const revocations = await adapter.getRevocations();
      expect(revocations.length).toBeGreaterThanOrEqual(1);
      const found = revocations.find(r => r.revocationId === 'rev_test_001');
      expect(found).toBeDefined();
      expect(found!.scope).toBe('chain');
    });

    it('handles missing entities gracefully', async () => {
      const adapter = createAdapter();

      expect(await adapter.getDelegation('nonexistent')).toBeNull();
      expect(await adapter.getAttestation('nonexistent')).toBeNull();
      expect(await adapter.getContract('nonexistent')).toBeNull();
      expect(await adapter.getTrustProfile('nonexistent')).toBeNull();
    });

    it('filters delegations by status', async () => {
      const adapter = createAdapter();

      const dct = createDCT({
        issuer: orchestrator,
        delegatee: agent.principal,
        capabilities: [{ namespace: 'code', action: '*', resource: '**' }],
        contractId: 'ct_filter',
        delegationId: 'del_filter_1',
        parentDelegationId: 'del_root',
        chainDepth: 0,
        maxChainDepth: 3,
        maxBudgetMicrocents: 1000,
        expiresAt: futureISO(1),
      });

      await adapter.saveDelegation({
        id: 'del_filter_active',
        parentId: 'del_root',
        from: orchestrator.principal.id,
        to: agent.principal.id,
        contractId: 'ct_filter',
        dct,
        depth: 0,
        status: 'active',
        createdAt: new Date().toISOString(),
      });

      await adapter.saveDelegation({
        id: 'del_filter_completed',
        parentId: 'del_root',
        from: orchestrator.principal.id,
        to: agent.principal.id,
        contractId: 'ct_filter',
        dct,
        depth: 0,
        status: 'completed',
        createdAt: new Date().toISOString(),
      });

      const active = await adapter.listDelegations({ status: 'active', contractId: 'ct_filter' });
      expect(active.length).toBe(1);
      expect(active[0].id).toBe('del_filter_active');

      const completed = await adapter.listDelegations({ status: 'completed', contractId: 'ct_filter' });
      expect(completed.length).toBe(1);
      expect(completed[0].id).toBe('del_filter_completed');
    });

    it('overwrites delegation on re-save (update status)', async () => {
      const adapter = createAdapter();

      const dct = createDCT({
        issuer: orchestrator,
        delegatee: agent.principal,
        capabilities: [{ namespace: 'code', action: '*', resource: '**' }],
        contractId: 'ct_update',
        delegationId: 'del_update',
        parentDelegationId: 'del_root',
        chainDepth: 0,
        maxChainDepth: 3,
        maxBudgetMicrocents: 1000,
        expiresAt: futureISO(1),
      });

      const del: Delegation = {
        id: 'del_update_test',
        parentId: 'del_root',
        from: orchestrator.principal.id,
        to: agent.principal.id,
        contractId: 'ct_update',
        dct,
        depth: 0,
        status: 'active',
        createdAt: new Date().toISOString(),
      };

      await adapter.saveDelegation(del);
      expect((await adapter.getDelegation('del_update_test'))!.status).toBe('active');

      await adapter.saveDelegation({ ...del, status: 'completed', completedAt: new Date().toISOString() });
      expect((await adapter.getDelegation('del_update_test'))!.status).toBe('completed');
    });
  });
}

runStorageRoundtrip('MemoryStorageAdapter roundtrip', () => new MemoryStorageAdapter());
runStorageRoundtrip('SqliteStorageAdapter roundtrip', () => new SqliteStorageAdapter(SQLITE_PATH));
