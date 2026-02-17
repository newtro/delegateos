import { describe, it, expect } from 'vitest';
import { generateKeypair } from '../src/core/crypto.js';
import { createDCT, attenuateDCT, verifyDCT, inspectDCT, getRevocationIds } from '../src/core/dct.js';
import type { Capability, VerificationContext } from '../src/core/types.js';

function futureISO(hours = 1): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

function pastISO(hours = 1): string {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

describe('DCT Engine', () => {
  const root = generateKeypair('root');
  const agent1 = generateKeypair('agent1');
  const agent2 = generateKeypair('agent2');

  const caps: Capability[] = [
    { namespace: 'web', action: 'search', resource: '*' },
    { namespace: 'docs', action: 'read', resource: '/project/*' },
  ];

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
      expiresAt: futureISO(1),
    });
  }

  function makeContext(overrides: Partial<VerificationContext> = {}): VerificationContext {
    return {
      resource: '*',
      operation: 'search',
      now: new Date().toISOString(),
      spentMicrocents: 0,
      rootPublicKey: root.principal.id,
      ...overrides,
    };
  }

  it('should create and verify a token', () => {
    const token = makeToken();
    const result = verifyDCT(token, makeContext());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.capabilities).toEqual(caps);
      expect(result.value.remainingBudgetMicrocents).toBe(1000000);
    }
  });

  it('should inspect a token', () => {
    const token = makeToken();
    const info = inspectDCT(token);
    expect(info.issuer).toBe(root.principal.id);
    expect(info.delegatee).toBe(agent1.principal.id);
    expect(info.capabilities).toEqual(caps);
  });

  it('should get revocation IDs', () => {
    const token = makeToken();
    const ids = getRevocationIds(token);
    expect(ids.length).toBe(1); // authority block only
  });

  it('should attenuate a token', () => {
    const token = makeToken();
    const narrowCaps: Capability[] = [{ namespace: 'web', action: 'search', resource: '*' }];
    const attenuated = attenuateDCT({
      token,
      attenuator: agent1,
      delegatee: agent2.principal,
      delegationId: 'del_test000002',
      contractId: 'ct_test000001',
      allowedCapabilities: narrowCaps,
      maxBudgetMicrocents: 500000,
    });

    const result = verifyDCT(attenuated, makeContext());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.capabilities).toEqual(narrowCaps);
      expect(result.value.remainingBudgetMicrocents).toBe(500000);
    }
  });

  it('should reject expired token', () => {
    const token = createDCT({
      issuer: root,
      delegatee: agent1.principal,
      capabilities: caps,
      contractId: 'ct_test000001',
      delegationId: 'del_test000001',
      parentDelegationId: 'del_000000000000',
      chainDepth: 0,
      maxChainDepth: 3,
      maxBudgetMicrocents: 1000000,
      expiresAt: pastISO(1),
    });
    const result = verifyDCT(token, makeContext());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('expired');
  });

  it('should reject budget exceeded', () => {
    const token = makeToken();
    const result = verifyDCT(token, makeContext({ spentMicrocents: 1000000 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('budget_exceeded');
  });

  it('should reject capability not granted', () => {
    const token = makeToken();
    const result = verifyDCT(token, makeContext({ operation: 'delete', resource: '/admin' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('capability_not_granted');
  });

  it('should reject wrong root key', () => {
    const token = makeToken();
    const result = verifyDCT(token, makeContext({ rootPublicKey: agent1.principal.id }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('invalid_signature');
  });

  it('should reject revoked token', () => {
    const token = makeToken();
    const revIds = getRevocationIds(token);
    const result = verifyDCT(token, makeContext({ revocationIds: revIds }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('revoked');
  });

  it('should reject capability expansion in attenuation', () => {
    const token = makeToken();
    expect(() => attenuateDCT({
      token,
      attenuator: agent1,
      delegatee: agent2.principal,
      delegationId: 'del_test000002',
      contractId: 'ct_test000001',
      allowedCapabilities: [{ namespace: 'admin', action: 'delete', resource: '*' }],
    })).toThrow();
  });

  it('should reject budget expansion in attenuation', () => {
    const token = makeToken();
    expect(() => attenuateDCT({
      token,
      attenuator: agent1,
      delegatee: agent2.principal,
      delegationId: 'del_test000002',
      contractId: 'ct_test000001',
      maxBudgetMicrocents: 2000000,
    })).toThrow();
  });

  it('should reject wrong attenuator', () => {
    const token = makeToken();
    expect(() => attenuateDCT({
      token,
      attenuator: agent2, // not the delegatee
      delegatee: agent2.principal,
      delegationId: 'del_test000002',
      contractId: 'ct_test000001',
    })).toThrow();
  });

  it('should handle forged signature', () => {
    const token = makeToken();
    // Tamper with the token
    const forged = { ...token, token: token.token.slice(0, -4) + 'AAAA' };
    const result = verifyDCT(forged, makeContext());
    expect(result.ok).toBe(false);
  });
});
