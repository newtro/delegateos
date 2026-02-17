/**
 * Tests for Distributed Revocation — Local and distributed stores.
 */

import { describe, it, expect } from 'vitest';
import {
  LocalRevocationStore,
  DistributedRevocationStore,
} from '../src/core/distributed-revocation.js';
import { generateKeypair } from '../src/core/crypto.js';
import { createRevocationEntry } from '../src/core/revocation.js';

describe('LocalRevocationStore', () => {
  it('stores and checks revocations', async () => {
    const store = new LocalRevocationStore();
    const kp = generateKeypair();
    const entry = createRevocationEntry(kp, 'rev_001');

    await store.revoke(entry);
    expect(await store.isRevoked('rev_001')).toBe(true);
    expect(await store.isRevoked('rev_999')).toBe(false);
  });

  it('lists revocations', async () => {
    const store = new LocalRevocationStore();
    const kp = generateKeypair();

    await store.revoke(createRevocationEntry(kp, 'rev_001'));
    await store.revoke(createRevocationEntry(kp, 'rev_002'));

    const all = await store.getRevocations();
    expect(all).toHaveLength(2);
  });

  it('filters revocations by since', async () => {
    const store = new LocalRevocationStore();
    const kp = generateKeypair();

    const old = createRevocationEntry(kp, 'rev_old');
    // Manually set old time
    (old as any).revokedAt = '2020-01-01T00:00:00.000Z';
    store.getInner().addUnchecked(old);

    await store.revoke(createRevocationEntry(kp, 'rev_new'));

    const recent = await store.getRevocations('2025-01-01T00:00:00.000Z');
    expect(recent).toHaveLength(1);
    expect(recent[0].revocationId).toBe('rev_new');
  });

  it('notifies subscribers', async () => {
    const store = new LocalRevocationStore();
    const kp = generateKeypair();
    const received: string[] = [];

    store.subscribe(entry => received.push(entry.revocationId));
    await store.revoke(createRevocationEntry(kp, 'rev_sub'));

    expect(received).toEqual(['rev_sub']);
  });

  it('unsubscribes correctly', async () => {
    const store = new LocalRevocationStore();
    const kp = generateKeypair();
    const received: string[] = [];

    const unsub = store.subscribe(entry => received.push(entry.revocationId));
    await store.revoke(createRevocationEntry(kp, 'rev_1'));
    unsub();
    await store.revoke(createRevocationEntry(kp, 'rev_2'));

    expect(received).toEqual(['rev_1']);
  });

  it('rejects invalid signature', async () => {
    const store = new LocalRevocationStore();
    const entry = {
      revocationId: 'rev_bad',
      revokedBy: 'fake_key',
      revokedAt: new Date().toISOString(),
      scope: 'block' as const,
      signature: 'invalid',
    };

    await expect(store.revoke(entry)).rejects.toThrow();
  });

  it('sync is a no-op', async () => {
    const store = new LocalRevocationStore();
    await expect(store.sync()).resolves.toBeUndefined();
  });
});

describe('DistributedRevocationStore', () => {
  it('stores and checks revocations', async () => {
    const store = new DistributedRevocationStore();
    const kp = generateKeypair();
    const entry = createRevocationEntry(kp, 'rev_dist_1');

    await store.revoke(entry);
    expect(await store.isRevoked('rev_dist_1')).toBe(true);
  });

  it('rejects invalid signatures', async () => {
    const store = new DistributedRevocationStore();
    await expect(store.revoke({
      revocationId: 'rev_bad',
      revokedBy: 'fake',
      revokedAt: new Date().toISOString(),
      scope: 'block',
      signature: 'bad',
    })).rejects.toThrow('Invalid revocation signature');
  });

  it('deduplicates revocations', async () => {
    const store = new DistributedRevocationStore();
    const kp = generateKeypair();
    const entry = createRevocationEntry(kp, 'rev_dup');

    await store.revoke(entry);
    await store.revoke(entry); // should not throw or duplicate

    const all = await store.getRevocations();
    expect(all).toHaveLength(1);
  });

  it('broadcasts to peers on revoke', async () => {
    const store1 = new DistributedRevocationStore();
    const store2 = new DistributedRevocationStore();

    store1.addPeer('peer2', 'local://peer2', store2);
    store2.addPeer('peer1', 'local://peer1', store1);

    const kp = generateKeypair();
    const entry = createRevocationEntry(kp, 'rev_gossip');

    await store1.revoke(entry);

    // store2 should have received it via gossip
    expect(await store2.isRevoked('rev_gossip')).toBe(true);
  });

  it('syncs missing entries from peers (anti-entropy)', async () => {
    const store1 = new DistributedRevocationStore();
    const store2 = new DistributedRevocationStore();

    const kp = generateKeypair();
    // Add entry to store1 without broadcasting
    const entry = createRevocationEntry(kp, 'rev_sync');
    await store1.revoke(entry);

    // Now connect and sync
    store2.addPeer('peer1', 'local://peer1', store1);
    await store2.sync();

    expect(await store2.isRevoked('rev_sync')).toBe(true);
  });

  it('handles 3-node gossip', async () => {
    const s1 = new DistributedRevocationStore();
    const s2 = new DistributedRevocationStore();
    const s3 = new DistributedRevocationStore();

    s1.addPeer('s2', 'l://s2', s2);
    s2.addPeer('s1', 'l://s1', s1);
    s2.addPeer('s3', 'l://s3', s3);
    s3.addPeer('s2', 'l://s2', s2);

    const kp = generateKeypair();
    await s1.revoke(createRevocationEntry(kp, 'rev_3node'));

    // s1 → s2 → s3
    expect(await s2.isRevoked('rev_3node')).toBe(true);
    expect(await s3.isRevoked('rev_3node')).toBe(true);
  });

  it('manages peers', () => {
    const store = new DistributedRevocationStore({ maxPeers: 2 });
    store.addPeer('a', 'l://a');
    store.addPeer('b', 'l://b');

    expect(store.getPeerIds()).toEqual(['a', 'b']);
    expect(() => store.addPeer('c', 'l://c')).toThrow('Max peers');

    store.removePeer('a');
    expect(store.getPeerIds()).toEqual(['b']);
  });

  it('notifies subscribers on receive from peer', async () => {
    const store1 = new DistributedRevocationStore();
    const store2 = new DistributedRevocationStore();
    store1.addPeer('s2', 'l://s2', store2);

    const received: string[] = [];
    store2.subscribe(e => received.push(e.revocationId));

    const kp = generateKeypair();
    await store1.revoke(createRevocationEntry(kp, 'rev_notify'));

    expect(received).toContain('rev_notify');
  });

  it('skips invalid entries during sync', async () => {
    const store1 = new DistributedRevocationStore();
    const store2 = new DistributedRevocationStore();

    // Manually inject an invalid entry into store1's inner store
    const kp = generateKeypair();
    const validEntry = createRevocationEntry(kp, 'rev_valid');
    await store1.revoke(validEntry);

    store2.addPeer('s1', 'l://s1', store1);
    await store2.sync();

    expect(await store2.isRevoked('rev_valid')).toBe(true);
  });

  it('start/stop sync does not throw', () => {
    const store = new DistributedRevocationStore({ syncIntervalMs: 100_000 });
    store.startSync();
    store.startSync(); // idempotent
    store.stopSync();
    store.stopSync(); // idempotent
  });
});
