import { describe, it, expect } from 'vitest';
import { MemoryChainStore, generateDelegationId } from '../src/core/chain.js';
import type { Delegation, SerializedDCT } from '../src/core/types.js';

const fakeDCT: SerializedDCT = { token: 'fake', format: 'delegateos-sjt-v1' };

function makeDelegation(overrides: Partial<Delegation> = {}): Delegation {
  return {
    id: generateDelegationId(),
    parentId: 'del_000000000000',
    from: 'pubkey_root',
    to: 'pubkey_agent1',
    contractId: 'ct_test000001',
    dct: fakeDCT,
    depth: 0,
    status: 'active',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('Delegation Chain', () => {
  it('should store and retrieve delegations', async () => {
    const store = new MemoryChainStore();
    const d = makeDelegation();
    await store.put(d);
    const retrieved = await store.get(d.id);
    expect(retrieved).toEqual(d);
  });

  it('should return null for missing delegation', async () => {
    const store = new MemoryChainStore();
    expect(await store.get('del_nonexistent')).toBeNull();
  });

  it('should get children', async () => {
    const store = new MemoryChainStore();
    const parent = makeDelegation({ id: 'del_parent000001' });
    const child1 = makeDelegation({ id: 'del_child0000001', parentId: parent.id, from: parent.to, to: 'pubkey_agent2', depth: 1 });
    const child2 = makeDelegation({ id: 'del_child0000002', parentId: parent.id, from: parent.to, to: 'pubkey_agent3', depth: 1 });
    await store.put(parent);
    await store.put(child1);
    await store.put(child2);

    const children = await store.getChildren(parent.id);
    expect(children.length).toBe(2);
  });

  it('should update status', async () => {
    const store = new MemoryChainStore();
    const d = makeDelegation();
    await store.put(d);
    await store.updateStatus(d.id, 'completed', 'att_test000001');
    const updated = await store.get(d.id);
    expect(updated?.status).toBe('completed');
    expect(updated?.attestationId).toBe('att_test000001');
    expect(updated?.completedAt).toBeDefined();
  });

  it('should throw on updating nonexistent delegation', async () => {
    const store = new MemoryChainStore();
    await expect(store.updateStatus('del_nope', 'completed')).rejects.toThrow();
  });

  it('should verify a valid chain', async () => {
    const store = new MemoryChainStore();
    const root = makeDelegation({ id: 'del_root00000001' });
    const child = makeDelegation({ id: 'del_child0000001', parentId: root.id, from: root.to, to: 'pubkey_agent2', depth: 1 });
    await store.put(root);
    await store.put(child);

    const result = await store.verifyChain(child.id);
    expect(result.valid).toBe(true);
  });

  it('should detect broken chain', async () => {
    const store = new MemoryChainStore();
    const root = makeDelegation({ id: 'del_root00000001' });
    const child = makeDelegation({ id: 'del_child0000001', parentId: root.id, from: 'wrong_pubkey', to: 'pubkey_agent2', depth: 1 });
    await store.put(root);
    await store.put(child);

    const result = await store.verifyChain(child.id);
    expect(result.valid).toBe(false);
  });

  it('should generate unique delegation IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateDelegationId()));
    expect(ids.size).toBe(100);
  });
});
