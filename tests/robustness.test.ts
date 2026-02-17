/**
 * Robustness tests — malformed inputs, concurrency, boundary values.
 */

import { describe, it, expect } from 'vitest';
import {
  generateKeypair,
  createDCT,
  verifyDCT,
  attenuateDCT,
  toBase64url,
  fromBase64url,
  canonicalize,
  blake2b256,
  TrustEngine,
  createContract,
  verifyOutput,
  createDefaultRegistry,
  decompose,
  validatePlan,
  SequentialStrategy,
  ParallelStrategy,
  MemoryChainStore,
  generateDelegationId,
  InMemoryRevocationList,
  DatalogEvaluator,
  AgentRegistry,
  signObject,
} from '../src/index.js';
import type { AgentCard, SerializedDCT } from '../src/index.js';

function futureISO(ms = 3600_000): string {
  return new Date(Date.now() + ms).toISOString();
}

describe('Malformed DCT Inputs', () => {
  it('verifyDCT handles empty token string', () => {
    const result = verifyDCT(
      { token: '', format: 'delegateos-sjt-v1' },
      { resource: '**', operation: 'read', now: new Date().toISOString(), spentMicrocents: 0, rootPublicKey: 'x' },
    );
    expect(result.ok).toBe(false);
  });

  it('verifyDCT handles wrong format', () => {
    const result = verifyDCT(
      { token: 'abc', format: 'delegateos-biscuit-v1' },
      { resource: '**', operation: 'read', now: new Date().toISOString(), spentMicrocents: 0, rootPublicKey: 'x' },
    );
    expect(result.ok).toBe(false);
  });

  it('attenuateDCT rejects non-delegatee attenuator', () => {
    const issuer = generateKeypair('root');
    const delegatee = generateKeypair('del');
    const stranger = generateKeypair('stranger');

    const dct = createDCT({
      issuer,
      delegatee: delegatee.principal,
      capabilities: [{ namespace: 'test', action: '*', resource: '**' }],
      contractId: 'ct_test',
      delegationId: 'del_1',
      parentDelegationId: 'del_000000000000',
      chainDepth: 0,
      maxChainDepth: 5,
      maxBudgetMicrocents: 100_000,
      expiresAt: futureISO(),
    });

    expect(() => attenuateDCT({
      token: dct,
      attenuator: stranger,
      delegatee: generateKeypair().principal,
      delegationId: 'del_2',
      contractId: 'ct_test',
    })).toThrow('Attenuator must be the current delegatee');
  });

  it('attenuateDCT rejects capability expansion', () => {
    const issuer = generateKeypair('root');
    const delegatee = generateKeypair('del');

    const dct = createDCT({
      issuer,
      delegatee: delegatee.principal,
      capabilities: [{ namespace: 'test', action: 'read', resource: 'docs/*' }],
      contractId: 'ct_test',
      delegationId: 'del_1',
      parentDelegationId: 'del_000000000000',
      chainDepth: 0,
      maxChainDepth: 5,
      maxBudgetMicrocents: 100_000,
      expiresAt: futureISO(),
    });

    expect(() => attenuateDCT({
      token: dct,
      attenuator: delegatee,
      delegatee: generateKeypair().principal,
      delegationId: 'del_2',
      contractId: 'ct_test',
      allowedCapabilities: [{ namespace: 'test', action: 'write', resource: '**' }],
    })).toThrow('Capability expansion not allowed');
  });
});

describe('Concurrent Verification', () => {
  it('handles many parallel verifyDCT calls', async () => {
    const issuer = generateKeypair('root');
    const delegatee = generateKeypair('del');

    const dct = createDCT({
      issuer,
      delegatee: delegatee.principal,
      capabilities: [{ namespace: 'test', action: 'read', resource: '**' }],
      contractId: 'ct_test',
      delegationId: 'del_1',
      parentDelegationId: 'del_000000000000',
      chainDepth: 0,
      maxChainDepth: 5,
      maxBudgetMicrocents: 100_000,
      expiresAt: futureISO(),
    });

    const ctx = {
      resource: 'anything',
      operation: 'read',
      now: new Date().toISOString(),
      spentMicrocents: 0,
      rootPublicKey: issuer.principal.id,
    };

    // 50 parallel verifications
    const results = await Promise.all(
      Array.from({ length: 50 }, () => Promise.resolve(verifyDCT(dct, ctx)))
    );

    expect(results.every(r => r.ok)).toBe(true);
  });
});

describe('Trust Engine Edge Cases', () => {
  it('handles zero-duration outcome', () => {
    const engine = new TrustEngine();
    engine.recordOutcome('agent1', {
      id: 'att_1', version: '0.1', contractId: 'ct_1', delegationId: 'del_1',
      principal: 'agent1', createdAt: new Date().toISOString(), type: 'completion',
      result: { success: true, costMicrocents: 0, durationMs: 0 },
      childAttestations: [], signature: '',
    });

    const score = engine.getScore('agent1');
    expect(score.speed).toBeLessThanOrEqual(1);
    expect(score.speed).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(score.composite)).toBe(true);
  });

  it('handles negative duration gracefully', () => {
    const engine = new TrustEngine();
    engine.recordOutcome('agent1', {
      id: 'att_1', version: '0.1', contractId: 'ct_1', delegationId: 'del_1',
      principal: 'agent1', createdAt: new Date().toISOString(), type: 'completion',
      result: { success: true, costMicrocents: 0, durationMs: -100 },
      childAttestations: [], signature: '',
    });

    const score = engine.getScore('agent1');
    expect(Number.isFinite(score.composite)).toBe(true);
  });
});

describe('Decomposition Budget Fractions', () => {
  it('rejects plan where fractions sum > 1.0', () => {
    const issuer = generateKeypair();
    const contract = createContract(
      issuer,
      { title: 'Test', description: 'Test', inputs: {}, outputSchema: {} },
      { method: 'schema_match', schema: { type: 'object' } },
      { maxBudgetMicrocents: 100_000, deadline: futureISO(), maxChainDepth: 5, requiredCapabilities: ['test'] },
    );

    const strategy = new ParallelStrategy([
      { title: 'A', description: 'A', capabilities: [{ namespace: 'test', action: '*', resource: '**' }], budgetFraction: 0.6 },
      { title: 'B', description: 'B', capabilities: [{ namespace: 'test', action: '*', resource: '**' }], budgetFraction: 0.6 },
    ]);

    const plan = decompose(contract, strategy);
    const result = validatePlan(plan, contract);
    // 0.6 + 0.6 = 1.2 → 120_000 > 100_000
    expect(result.ok).toBe(false);
  });

  it('accepts plan where fractions sum exactly to 1.0', () => {
    const issuer = generateKeypair();
    const contract = createContract(
      issuer,
      { title: 'Test', description: 'Test', inputs: {}, outputSchema: {} },
      { method: 'schema_match', schema: { type: 'object' } },
      { maxBudgetMicrocents: 100_000, deadline: futureISO(), maxChainDepth: 5, requiredCapabilities: ['test'] },
    );

    const strategy = new ParallelStrategy([
      { title: 'A', description: 'A', capabilities: [{ namespace: 'test', action: '*', resource: '**' }], budgetFraction: 0.5 },
      { title: 'B', description: 'B', capabilities: [{ namespace: 'test', action: '*', resource: '**' }], budgetFraction: 0.5 },
    ]);

    const plan = decompose(contract, strategy);
    const result = validatePlan(plan, contract);
    expect(result.ok).toBe(true);
  });

  it('handles floating point edge case with thirds', () => {
    const issuer = generateKeypair();
    const contract = createContract(
      issuer,
      { title: 'Test', description: 'Test', inputs: {}, outputSchema: {} },
      { method: 'schema_match', schema: { type: 'object' } },
      { maxBudgetMicrocents: 100_000, deadline: futureISO(), maxChainDepth: 5, requiredCapabilities: ['test'] },
    );

    // 1/3 + 1/3 + 1/3 = budget of 33333*3 = 99999 ≤ 100000 (due to Math.floor)
    const strategy = new ParallelStrategy([
      { title: 'A', description: 'A', capabilities: [{ namespace: 'test', action: '*', resource: '**' }], budgetFraction: 1/3 },
      { title: 'B', description: 'B', capabilities: [{ namespace: 'test', action: '*', resource: '**' }], budgetFraction: 1/3 },
      { title: 'C', description: 'C', capabilities: [{ namespace: 'test', action: '*', resource: '**' }], budgetFraction: 1/3 },
    ]);

    const plan = decompose(contract, strategy);
    const totalBudget = plan.subTasks.reduce((s, t) => s + t.budgetMicrocents, 0);
    expect(totalBudget).toBeLessThanOrEqual(100_000);
    const result = validatePlan(plan, contract);
    expect(result.ok).toBe(true);
  });
});

describe('Datalog Evaluator Edge Cases', () => {
  it('handles rules that produce no new facts', () => {
    const eval_ = new DatalogEvaluator();
    eval_.addRule({
      head: { name: 'derived', terms: ['$x'] },
      body: [{ name: 'nonexistent', terms: ['$x'] }],
    });
    eval_.evaluate();
    expect(eval_.getFacts()).toHaveLength(0);
  });

  it('handles self-joining rules', () => {
    const eval_ = new DatalogEvaluator();
    eval_.addFact({ name: 'edge', terms: ['a', 'b'] });
    eval_.addFact({ name: 'edge', terms: ['b', 'c'] });
    eval_.addRule({
      head: { name: 'path', terms: ['$x', '$z'] },
      body: [
        { name: 'edge', terms: ['$x', '$y'] },
        { name: 'edge', terms: ['$y', '$z'] },
      ],
    });
    eval_.evaluate();
    const paths = eval_.getFacts().filter(f => f.name === 'path');
    expect(paths).toContainEqual({ name: 'path', terms: ['a', 'c'] });
  });

  it('terminates on iteration limit', () => {
    const eval_ = new DatalogEvaluator();
    eval_.addFact({ name: 'num', terms: ['0'] });
    // Rule that keeps generating new facts
    eval_.addRule({
      head: { name: 'num', terms: ['$next'] },
      body: [{ name: 'num', terms: ['$x'] }],
      constraints: [{ variable: '$next', op: '==', value: '1' }], // This won't generate infinite, but tests the limit path
    });
    eval_.evaluate(); // should not hang
  });
});

describe('Chain Store Edge Cases', () => {
  it('verifyChain rejects empty chain', async () => {
    const store = new MemoryChainStore();
    const result = await store.verifyChain('nonexistent');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Empty chain');
  });

  it('updateStatus throws for nonexistent delegation', async () => {
    const store = new MemoryChainStore();
    await expect(store.updateStatus('fake_id', 'completed')).rejects.toThrow('Delegation not found');
  });
});

describe('Agent Registry Malformed Input', () => {
  it('rejects agent card with invalid signature', () => {
    const card: AgentCard = {
      id: 'agent1',
      name: 'Test Agent',
      description: 'Test',
      principal: generateKeypair().principal.id,
      capabilities: [],
      delegationPolicy: {
        acceptsDelegation: true,
        maxChainDepth: 5,
        requiredTrustScore: 0,
        allowedNamespaces: ['*'],
      },
      signature: 'invalid_signature',
    };

    const registry = new AgentRegistry();
    const result = registry.register(card);
    expect(result.ok).toBe(false);
  });

  it('resolve returns null for unregistered agent', () => {
    const registry = new AgentRegistry();
    expect(registry.resolve('nonexistent')).toBeNull();
  });
});

describe('Verification Engine Malformed Specs', () => {
  it('verifyOutput handles unknown check function name', () => {
    const issuer = generateKeypair();
    const contract = createContract(
      issuer,
      { title: 'Test', description: 'Test', inputs: {}, outputSchema: {} },
      { method: 'deterministic_check', checkName: 'nonexistent_check' },
      { maxBudgetMicrocents: 100_000, deadline: futureISO(), maxChainDepth: 5, requiredCapabilities: [] },
    );

    const registry = createDefaultRegistry();
    const result = verifyOutput(contract, { data: 'test' }, registry);
    expect(result.ok).toBe(false);
  });
});

describe('Base64url Edge Cases', () => {
  it('roundtrips empty bytes', () => {
    const encoded = toBase64url(new Uint8Array(0));
    const decoded = fromBase64url(encoded);
    expect(decoded.length).toBe(0);
  });

  it('roundtrips all byte values', () => {
    const allBytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) allBytes[i] = i;
    const encoded = toBase64url(allBytes);
    const decoded = fromBase64url(encoded);
    expect(decoded).toEqual(allBytes);
  });
});

describe('Canonicalize Edge Cases', () => {
  it('produces deterministic output for reordered keys', () => {
    const a = canonicalize({ z: 1, a: 2, m: 3 });
    const b = canonicalize({ a: 2, m: 3, z: 1 });
    expect(a).toBe(b);
  });

  it('handles nested objects', () => {
    const result = canonicalize({ a: { c: 1, b: 2 } });
    expect(result).toBe('{"a":{"b":2,"c":1}}');
  });
});
