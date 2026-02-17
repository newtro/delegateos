import { describe, it, expect } from 'vitest';
import { DatalogEvaluator, createBiscuitDCT, attenuateBiscuitDCT, verifyBiscuitDCT, DCTEngineFactory } from '../src/core/biscuit.js';
import { generateKeypair } from '../src/core/crypto.js';

describe('DatalogEvaluator', () => {
  it('stores and retrieves facts', () => {
    const eval_ = new DatalogEvaluator();
    eval_.addFact({ name: 'user', terms: ['alice'] });
    expect(eval_.getFacts()).toHaveLength(1);
  });

  it('forward-chains rules to generate new facts', () => {
    const eval_ = new DatalogEvaluator();
    eval_.addFact({ name: 'parent', terms: ['alice', 'bob'] });
    eval_.addFact({ name: 'parent', terms: ['bob', 'carol'] });
    eval_.addRule({
      head: { name: 'grandparent', terms: ['$a', '$c'] },
      body: [
        { name: 'parent', terms: ['$a', '$b'] },
        { name: 'parent', terms: ['$b', '$c'] },
      ],
    });
    eval_.evaluate();
    const facts = eval_.getFacts();
    const gp = facts.find(f => f.name === 'grandparent');
    expect(gp).toBeDefined();
    expect(gp!.terms).toEqual(['alice', 'carol']);
  });

  it('checks pass when matching facts exist', () => {
    const eval_ = new DatalogEvaluator();
    eval_.addFact({ name: 'right', terms: ['web', 'search', '*'] });
    eval_.addCheck({
      rules: [{
        head: { name: 'check', terms: [] },
        body: [{ name: 'right', terms: ['web', '$action', '$resource'] }],
      }],
    });
    expect(eval_.runChecks().passed).toBe(true);
  });

  it('checks fail when no matching facts', () => {
    const eval_ = new DatalogEvaluator();
    eval_.addCheck({
      rules: [{
        head: { name: 'check', terms: [] },
        body: [{ name: 'right', terms: ['web', 'search', '*'] }],
      }],
    });
    expect(eval_.runChecks().passed).toBe(false);
  });

  it('policies return allow/deny', () => {
    const eval_ = new DatalogEvaluator();
    eval_.addFact({ name: 'right', terms: ['web', 'search', '*'] });
    eval_.addPolicy({
      kind: 'allow',
      rules: [{
        head: { name: 'allow', terms: [] },
        body: [{ name: 'right', terms: ['$ns', '$action', '$resource'] }],
      }],
    });
    expect(eval_.runPolicies()).toBe('allow');
  });

  it('constraints filter bindings', () => {
    const eval_ = new DatalogEvaluator();
    eval_.addFact({ name: 'budget', terms: ['500'] });
    eval_.addFact({ name: 'budget', terms: ['1500'] });
    eval_.addCheck({
      rules: [{
        head: { name: 'check', terms: [] },
        body: [{ name: 'budget', terms: ['$val'] }],
        constraints: [{ variable: '$val', op: '<=', value: '1000' }],
      }],
    });
    expect(eval_.runChecks().passed).toBe(true);
  });
});

describe('Biscuit DCT Engine', () => {
  const alice = generateKeypair('alice');
  const bob = generateKeypair('bob');
  const carol = generateKeypair('carol');
  const futureExpiry = new Date(Date.now() + 3600_000).toISOString();

  it('creates and verifies a biscuit token', () => {
    const dct = createBiscuitDCT({
      issuer: alice,
      delegatee: bob.principal,
      capabilities: [{ namespace: 'web', action: 'search', resource: '*' }],
      contractId: 'ct_1',
      delegationId: 'del_1',
      parentDelegationId: 'del_000000000000',
      chainDepth: 0,
      maxChainDepth: 5,
      maxBudgetMicrocents: 500_000,
      expiresAt: futureExpiry,
    });

    expect(dct.format).toBe('delegateos-biscuit-v1');

    const result = verifyBiscuitDCT(dct, {
      resource: 'anything',
      namespace: 'web',
      operation: 'search',
      now: new Date().toISOString(),
      spentMicrocents: 0,
      rootPublicKey: alice.principal.id,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.remainingBudgetMicrocents).toBe(500_000);
    }
  });

  it('attenuates a biscuit token', () => {
    const dct = createBiscuitDCT({
      issuer: alice,
      delegatee: bob.principal,
      capabilities: [{ namespace: 'web', action: 'search', resource: '*' }],
      contractId: 'ct_1',
      delegationId: 'del_1',
      parentDelegationId: 'del_000000000000',
      chainDepth: 0,
      maxChainDepth: 5,
      maxBudgetMicrocents: 500_000,
      expiresAt: futureExpiry,
    });

    const narrowed = attenuateBiscuitDCT({
      token: dct,
      attenuator: bob,
      delegatee: carol.principal,
      delegationId: 'del_2',
      contractId: 'ct_1',
      maxBudgetMicrocents: 100_000,
    });

    const result = verifyBiscuitDCT(narrowed, {
      resource: 'test',
      namespace: 'web',
      operation: 'search',
      now: new Date().toISOString(),
      spentMicrocents: 0,
      rootPublicKey: alice.principal.id,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.remainingBudgetMicrocents).toBe(100_000);
    }
  });

  it('rejects expired biscuit token', () => {
    const dct = createBiscuitDCT({
      issuer: alice,
      delegatee: bob.principal,
      capabilities: [{ namespace: 'web', action: 'search', resource: '*' }],
      contractId: 'ct_1',
      delegationId: 'del_1',
      parentDelegationId: 'del_000000000000',
      chainDepth: 0,
      maxChainDepth: 5,
      maxBudgetMicrocents: 500_000,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    const result = verifyBiscuitDCT(dct, {
      resource: 'test',
      namespace: 'web',
      operation: 'search',
      now: new Date().toISOString(),
      spentMicrocents: 0,
      rootPublicKey: alice.principal.id,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('expired');
  });

  it('rejects wrong root key', () => {
    const dct = createBiscuitDCT({
      issuer: alice,
      delegatee: bob.principal,
      capabilities: [{ namespace: 'web', action: 'search', resource: '*' }],
      contractId: 'ct_1',
      delegationId: 'del_1',
      parentDelegationId: 'del_000000000000',
      chainDepth: 0,
      maxChainDepth: 5,
      maxBudgetMicrocents: 500_000,
      expiresAt: futureExpiry,
    });

    const result = verifyBiscuitDCT(dct, {
      resource: 'test',
      namespace: 'web',
      operation: 'search',
      now: new Date().toISOString(),
      spentMicrocents: 0,
      rootPublicKey: bob.principal.id,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('invalid_signature');
  });

  it('rejects capability not granted', () => {
    const dct = createBiscuitDCT({
      issuer: alice,
      delegatee: bob.principal,
      capabilities: [{ namespace: 'web', action: 'search', resource: '*' }],
      contractId: 'ct_1',
      delegationId: 'del_1',
      parentDelegationId: 'del_000000000000',
      chainDepth: 0,
      maxChainDepth: 5,
      maxBudgetMicrocents: 500_000,
      expiresAt: futureExpiry,
    });

    const result = verifyBiscuitDCT(dct, {
      resource: 'test',
      namespace: 'docs',
      operation: 'read',
      now: new Date().toISOString(),
      spentMicrocents: 0,
      rootPublicKey: alice.principal.id,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('capability_not_granted');
  });

  it('DCTEngineFactory creates biscuit engine', () => {
    const engine = DCTEngineFactory.create('biscuit');
    expect(engine).not.toBeNull();
    expect(engine!.createDCT).toBeDefined();
    expect(engine!.verifyDCT).toBeDefined();
  });

  it('DCTEngineFactory returns SJT engine for sjt format', () => {
    const engine = DCTEngineFactory.create('sjt');
    expect(engine).not.toBeNull();
    expect(engine.createDCT).toBeTypeOf('function');
    expect(engine.attenuateDCT).toBeTypeOf('function');
    expect(engine.verifyDCT).toBeTypeOf('function');
  });
});
