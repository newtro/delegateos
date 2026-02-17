import { describe, it, expect } from 'vitest';
import { generateKeypair } from '../src/core/crypto.js';
import { createDCT, attenuateDCT, verifyDCT, inspectDCT, _matchGlob } from '../src/core/dct.js';
import { InMemoryBudgetTracker } from '../src/mcp/types.js';
import type { Capability, VerificationContext } from '../src/core/types.js';

function futureISO(hours = 1): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

describe('Glob matching (_matchGlob)', () => {
  it('exact match', () => expect(_matchGlob('foo/bar', 'foo/bar')).toBe(true));
  it('no match', () => expect(_matchGlob('foo/bar', 'foo/baz')).toBe(false));
  it('* matches single segment', () => expect(_matchGlob('foo/*', 'foo/bar')).toBe(true));
  it('* does not match nested', () => expect(_matchGlob('foo/*', 'foo/bar/baz')).toBe(false));
  it('** matches everything', () => expect(_matchGlob('**', 'a/b/c')).toBe(true));
  it('prefix/** matches nested', () => expect(_matchGlob('src/**', 'src/a/b/c')).toBe(true));
  it('prefix/** matches direct child', () => expect(_matchGlob('src/**', 'src/a')).toBe(true));
  it('mid ** glob', () => expect(_matchGlob('src/**/test', 'src/a/b/test')).toBe(true));
  it('empty pattern vs empty value', () => expect(_matchGlob('', '')).toBe(true));
  it('* alone matches single segment', () => expect(_matchGlob('*', 'foo')).toBe(true));
});

describe('DCT chain depth exceeded', () => {
  const root = generateKeypair('root');
  const agent = generateKeypair('agent');

  it('should reject when chain depth exceeds context limit', () => {
    const token = createDCT({
      issuer: root,
      delegatee: agent.principal,
      capabilities: [{ namespace: 'code', action: 'read', resource: '*' }],
      contractId: 'ct_1',
      delegationId: 'del_1',
      parentDelegationId: 'del_000000000000',
      chainDepth: 5,
      maxChainDepth: 10,
      maxBudgetMicrocents: 1000,
      expiresAt: futureISO(),
    });

    const result = verifyDCT(token, {
      resource: '*',
      operation: 'read',
      now: new Date().toISOString(),
      spentMicrocents: 0,
      rootPublicKey: root.principal.id,
      maxChainDepth: 3, // limit lower than chainDepth
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('chain_depth_exceeded');
  });
});

describe('DCT namespace matching', () => {
  const root = generateKeypair('root');
  const agent = generateKeypair('agent');

  it('should match wildcard namespace in capability', () => {
    const token = createDCT({
      issuer: root,
      delegatee: agent.principal,
      capabilities: [{ namespace: '*', action: 'read', resource: '*' }],
      contractId: 'ct_1',
      delegationId: 'del_1',
      parentDelegationId: 'del_000000000000',
      chainDepth: 0,
      maxChainDepth: 3,
      maxBudgetMicrocents: 1000,
      expiresAt: futureISO(),
    });

    const result = verifyDCT(token, {
      resource: '*',
      namespace: 'anything',
      operation: 'read',
      now: new Date().toISOString(),
      spentMicrocents: 0,
      rootPublicKey: root.principal.id,
    });

    expect(result.ok).toBe(true);
  });
});

describe('DCT attenuation expiry enforcement', () => {
  const root = generateKeypair('root');
  const agent1 = generateKeypair('agent1');
  const agent2 = generateKeypair('agent2');

  it('should reject attenuation with later expiry than parent', () => {
    const token = createDCT({
      issuer: root,
      delegatee: agent1.principal,
      capabilities: [{ namespace: 'code', action: 'read', resource: '*' }],
      contractId: 'ct_1',
      delegationId: 'del_1',
      parentDelegationId: 'del_000000000000',
      chainDepth: 0,
      maxChainDepth: 3,
      maxBudgetMicrocents: 1000,
      expiresAt: futureISO(1),
    });

    expect(() => attenuateDCT({
      token,
      attenuator: agent1,
      delegatee: agent2.principal,
      delegationId: 'del_2',
      contractId: 'ct_1',
      expiresAt: futureISO(2), // later than parent
    })).toThrow('Expiry cannot exceed parent');
  });
});

describe('DCT double attenuation', () => {
  const root = generateKeypair('root');
  const a1 = generateKeypair('a1');
  const a2 = generateKeypair('a2');
  const a3 = generateKeypair('a3');

  it('should support two levels of attenuation', () => {
    const token = createDCT({
      issuer: root,
      delegatee: a1.principal,
      capabilities: [
        { namespace: 'code', action: 'read', resource: '**' },
        { namespace: 'code', action: 'write', resource: '**' },
      ],
      contractId: 'ct_1',
      delegationId: 'del_1',
      parentDelegationId: 'del_000000000000',
      chainDepth: 0,
      maxChainDepth: 5,
      maxBudgetMicrocents: 10000,
      expiresAt: futureISO(),
    });

    const att1 = attenuateDCT({
      token,
      attenuator: a1,
      delegatee: a2.principal,
      delegationId: 'del_2',
      contractId: 'ct_1',
      allowedCapabilities: [{ namespace: 'code', action: 'read', resource: '**' }],
      maxBudgetMicrocents: 5000,
      maxChainDepth: 3,
    });

    const att2 = attenuateDCT({
      token: att1,
      attenuator: a2,
      delegatee: a3.principal,
      delegationId: 'del_3',
      contractId: 'ct_1',
      maxBudgetMicrocents: 2000,
      maxChainDepth: 1,
    });

    const result = verifyDCT(att2, {
      resource: 'src/foo.ts',
      operation: 'read',
      now: new Date().toISOString(),
      spentMicrocents: 0,
      rootPublicKey: root.principal.id,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.remainingBudgetMicrocents).toBe(2000);
      expect(result.value.chainDepth).toBe(2);
    }

    // Write should be denied after first attenuation narrowed to read-only
    const writeResult = verifyDCT(att2, {
      resource: 'src/foo.ts',
      operation: 'write',
      now: new Date().toISOString(),
      spentMicrocents: 0,
      rootPublicKey: root.principal.id,
    });
    expect(writeResult.ok).toBe(false);
  });
});

describe('inspectDCT with attenuations', () => {
  const root = generateKeypair('root');
  const a1 = generateKeypair('a1');
  const a2 = generateKeypair('a2');

  it('should report effective delegatee after attenuation', () => {
    const token = createDCT({
      issuer: root,
      delegatee: a1.principal,
      capabilities: [{ namespace: 'code', action: 'read', resource: '**' }],
      contractId: 'ct_1',
      delegationId: 'del_1',
      parentDelegationId: 'del_000000000000',
      chainDepth: 0,
      maxChainDepth: 3,
      maxBudgetMicrocents: 1000,
      expiresAt: futureISO(),
    });

    const att = attenuateDCT({
      token,
      attenuator: a1,
      delegatee: a2.principal,
      delegationId: 'del_2',
      contractId: 'ct_1',
      maxChainDepth: 1,
    });

    const info = inspectDCT(att);
    expect(info.delegatee).toBe(a2.principal.id);
    expect(info.chainDepth).toBe(1);
    expect(info.revocationIds.length).toBe(2); // authority + 1 attenuation
  });
});

describe('InMemoryBudgetTracker', () => {
  it('should track cumulative spend', () => {
    const bt = new InMemoryBudgetTracker();
    expect(bt.getSpent('del_1')).toBe(0);
    bt.recordSpend('del_1', 100);
    bt.recordSpend('del_1', 200);
    expect(bt.getSpent('del_1')).toBe(300);
  });

  it('should track independently per delegation', () => {
    const bt = new InMemoryBudgetTracker();
    bt.recordSpend('del_1', 100);
    bt.recordSpend('del_2', 500);
    expect(bt.getSpent('del_1')).toBe(100);
    expect(bt.getSpent('del_2')).toBe(500);
  });
});

describe('DCT malformed token handling', () => {
  it('should return malformed_token for garbage input', () => {
    const result = verifyDCT(
      { token: 'not-valid-base64!@#$', format: 'delegateos-sjt-v1' },
      {
        resource: '*',
        operation: 'read',
        now: new Date().toISOString(),
        spentMicrocents: 0,
        rootPublicKey: 'fake',
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('malformed_token');
  });

  it('should return malformed_token for wrong format', () => {
    const result = verifyDCT(
      { token: 'abc', format: 'delegateos-biscuit-v1' },
      {
        resource: '*',
        operation: 'read',
        now: new Date().toISOString(),
        spentMicrocents: 0,
        rootPublicKey: 'fake',
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('malformed_token');
  });
});
