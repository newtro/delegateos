/**
 * Tests that DCTEngineFactory produces interchangeable engines.
 */

import { describe, it, expect } from 'vitest';
import {
  generateKeypair,
  DCTEngineFactory,
} from '../src/index.js';
import type { DCTFormat } from '../src/index.js';

function futureISO(ms = 3600_000): string {
  return new Date(Date.now() + ms).toISOString();
}

describe.each(['sjt', 'biscuit'] as DCTFormat[])('DCTEngineFactory(%s)', (format) => {
  it('creates, attenuates, and verifies a token', () => {
    const engine = DCTEngineFactory.create(format);
    const root = generateKeypair('root');
    const mid = generateKeypair('mid');
    const leaf = generateKeypair('leaf');

    const rootDCT = engine.createDCT({
      issuer: root,
      delegatee: mid.principal,
      capabilities: [{ namespace: 'test', action: 'read', resource: '**' }],
      contractId: 'ct_1',
      delegationId: 'del_1',
      parentDelegationId: 'del_000000000000',
      chainDepth: 0,
      maxChainDepth: 5,
      maxBudgetMicrocents: 100_000,
      expiresAt: futureISO(),
    });

    const attenuated = engine.attenuateDCT({
      token: rootDCT,
      attenuator: mid,
      delegatee: leaf.principal,
      delegationId: 'del_2',
      contractId: 'ct_1',
      maxBudgetMicrocents: 50_000,
    });

    const result = engine.verifyDCT(attenuated, {
      resource: 'anything',
      operation: 'read',
      now: new Date().toISOString(),
      spentMicrocents: 0,
      rootPublicKey: root.principal.id,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.remainingBudgetMicrocents).toBe(50_000);
    }
  });

  it('rejects expired token', () => {
    const engine = DCTEngineFactory.create(format);
    const root = generateKeypair('root');
    const del = generateKeypair('del');

    const dct = engine.createDCT({
      issuer: root,
      delegatee: del.principal,
      capabilities: [{ namespace: 'test', action: 'read', resource: '**' }],
      contractId: 'ct_1',
      delegationId: 'del_1',
      parentDelegationId: 'del_000000000000',
      chainDepth: 0,
      maxChainDepth: 5,
      maxBudgetMicrocents: 100_000,
      expiresAt: new Date(Date.now() - 1000).toISOString(), // already expired
    });

    const result = engine.verifyDCT(dct, {
      resource: 'anything',
      operation: 'read',
      now: new Date().toISOString(),
      spentMicrocents: 0,
      rootPublicKey: root.principal.id,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('expired');
  });
});
