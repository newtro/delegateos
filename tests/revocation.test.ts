import { describe, it, expect } from 'vitest';
import { generateKeypair } from '../src/core/crypto.js';
import { createDCT, getRevocationIds, verifyDCT } from '../src/core/dct.js';
import { InMemoryRevocationList, createRevocationEntry, cascadeRevoke } from '../src/core/revocation.js';
import type { Capability, VerificationContext } from '../src/core/types.js';

const root = generateKeypair('root');
const agent1 = generateKeypair('agent1');

const caps: Capability[] = [{ namespace: 'web', action: 'search', resource: '*' }];

function makeToken() {
  return createDCT({
    issuer: root,
    delegatee: agent1.principal,
    capabilities: caps,
    contractId: 'ct_test000001',
    delegationId: 'del_test000001',
    parentDelegationId: 'del_000000000000',
    chainDepth: 0,
    maxChainDepth: 3,
    maxBudgetMicrocents: 1000000,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
}

describe('Revocation List', () => {
  it('should add and check revocations', () => {
    const list = new InMemoryRevocationList();
    const entry = createRevocationEntry(root, 'rev_test_id', 'block');
    const result = list.add(entry);
    expect(result.ok).toBe(true);
    expect(list.isRevoked('rev_test_id')).toBe(true);
    expect(list.isRevoked('other_id')).toBe(false);
  });

  it('should list revocations', () => {
    const list = new InMemoryRevocationList();
    list.add(createRevocationEntry(root, 'rev1', 'block'));
    list.add(createRevocationEntry(root, 'rev2', 'chain'));
    expect(list.list().length).toBe(2);
  });

  it('should remove revocations', () => {
    const list = new InMemoryRevocationList();
    list.add(createRevocationEntry(root, 'rev1', 'block'));
    expect(list.isRevoked('rev1')).toBe(true);
    list.remove('rev1');
    expect(list.isRevoked('rev1')).toBe(false);
  });

  it('should reject invalid signature', () => {
    const list = new InMemoryRevocationList();
    const entry = createRevocationEntry(root, 'rev1', 'block');
    entry.signature = 'invalid_signature_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAx';
    const result = list.add(entry);
    expect(result.ok).toBe(false);
  });

  it('should serialize and deserialize', () => {
    const list = new InMemoryRevocationList();
    list.addUnchecked({ revocationId: 'rev1', revokedBy: 'key1', revokedAt: '2026-01-01T00:00:00Z', scope: 'block', signature: 'sig1' });
    const json = list.toJSON();
    const restored = InMemoryRevocationList.fromJSON(json);
    expect(restored.isRevoked('rev1')).toBe(true);
  });

  it('should cascade revoke all token IDs', () => {
    const token = makeToken();
    const revIds = getRevocationIds(token);
    const list = new InMemoryRevocationList();
    cascadeRevoke(list, root, revIds);
    for (const id of revIds) {
      expect(list.isRevoked(id)).toBe(true);
    }
  });

  it('should integrate with DCT verification', () => {
    const token = makeToken();
    const revIds = getRevocationIds(token);
    const ctx: VerificationContext = {
      resource: '*',
      operation: 'search',
      now: new Date().toISOString(),
      spentMicrocents: 0,
      rootPublicKey: root.principal.id,
      revocationIds: revIds,
    };
    const result = verifyDCT(token, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('revoked');
  });
});
