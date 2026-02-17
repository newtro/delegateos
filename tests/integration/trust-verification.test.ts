/**
 * Integration tests — Trust engine + verification engine working together.
 */

import { describe, it, expect } from 'vitest';
import { generateKeypair, signObject } from '../../src/core/crypto.js';
import { TrustEngine } from '../../src/core/trust.js';
import { VerificationEngine, MockLLMJudge, MockHumanReview } from '../../src/core/verification.js';
import { AgentRegistry } from '../../src/a2a/registry.js';
import { DelegationBroker } from '../../src/a2a/broker.js';
import { createContract } from '../../src/core/contract.js';
import { createCompletionAttestation } from '../../src/core/attestation.js';
import type { AgentCard } from '../../src/a2a/types.js';
import type { Keypair, Attestation } from '../../src/core/types.js';
import type { ExtendedVerificationSpec } from '../../src/core/verification.js';

function futureISO(hours = 1): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

function createAgentCard(kp: Keypair, overrides: Partial<AgentCard> = {}): AgentCard {
  const card: AgentCard = {
    id: `agent_${kp.principal.id.slice(0, 8)}`,
    name: kp.principal.name ?? 'Agent',
    description: 'Test agent',
    principal: kp.principal.id,
    capabilities: [{ namespace: 'code', action: '*', resource: '**' }],
    delegationPolicy: { acceptsDelegation: true, maxChainDepth: 5, requiredTrustScore: 0, allowedNamespaces: ['code'] },
    metadata: {},
    signature: '',
    ...overrides,
  };
  const { signature: _, ...toSign } = card;
  card.signature = signObject(kp.privateKey, toSign);
  return card;
}

function makeAttestation(keys: Keypair, contractId: string, success: boolean, quality = 0.9): Attestation {
  return createCompletionAttestation(keys, contractId, 'del_test', {
    success,
    output: { result: success ? 'good' : 'bad' },
    costMicrocents: 500,
    durationMs: success ? 1000 : 10000,
    verificationOutcome: { method: 'test', passed: success, score: quality },
  });
}

describe('Trust + Verification Integration', () => {
  const orchestrator = generateKeypair('Orchestrator');
  const goodAgent = generateKeypair('GoodAgent');
  const badAgent = generateKeypair('BadAgent');

  it('agent completes tasks → trust improves → can handle harder tasks', () => {
    const trustEngine = new TrustEngine();
    for (let i = 0; i < 5; i++) {
      const att = makeAttestation(goodAgent, `ct_${i}`, true, 0.9);
      trustEngine.recordOutcome(goodAgent.principal.id, att);
    }
    const score = trustEngine.getScore(goodAgent.principal.id);
    expect(score.composite).toBeGreaterThan(0.7);
    expect(score.reliability).toBeGreaterThan(0.8);
    expect(score.totalOutcomes).toBe(5);
  });

  it('agent fails → trust drops → gets filtered out of discovery', () => {
    const trustEngine = new TrustEngine();
    const registry = new AgentRegistry();
    const broker = new DelegationBroker(registry, trustEngine);

    registry.register(createAgentCard(goodAgent, {
      name: 'GoodAgent',
      delegationPolicy: { acceptsDelegation: true, maxChainDepth: 5, requiredTrustScore: 0.3, allowedNamespaces: ['code'] },
    }));
    registry.register(createAgentCard(badAgent, {
      name: 'BadAgent',
      delegationPolicy: { acceptsDelegation: true, maxChainDepth: 5, requiredTrustScore: 0.3, allowedNamespaces: ['code'] },
    }));

    for (let i = 0; i < 5; i++) {
      trustEngine.recordOutcome(goodAgent.principal.id, makeAttestation(goodAgent, `ct_good_${i}`, true));
    }
    for (let i = 0; i < 5; i++) {
      trustEngine.recordOutcome(badAgent.principal.id, makeAttestation(badAgent, `ct_bad_${i}`, false, 0.1));
    }

    const goodScore = trustEngine.getScore(goodAgent.principal.id);
    const badScore = trustEngine.getScore(badAgent.principal.id);
    expect(goodScore.composite).toBeGreaterThan(badScore.composite);

    const contract = createContract(
      orchestrator,
      { title: 'Test', description: 'test', inputs: {}, outputSchema: { type: 'object' } },
      { method: 'schema_match', schema: { type: 'object' } },
      { maxBudgetMicrocents: 5000, deadline: futureISO(2), maxChainDepth: 3, requiredCapabilities: ['code'] },
    );
    const result = broker.findAgent(contract);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.principal).toBe(goodAgent.principal.id);
    }
  });

  it('LLM judge verification with mock adapter', async () => {
    const judge = new MockLLMJudge(0.85);
    const engine = new VerificationEngine();
    engine.registerLLMJudge(judge);

    const spec: ExtendedVerificationSpec = {
      method: 'llm_judge',
      prompt: 'Is this code review thorough?',
      criteria: ['completeness', 'accuracy'],
      passingScore: 0.7,
    };
    const result = await engine.verify({ approved: true, comments: ['LGTM'] }, spec);
    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.7);
    expect(judge.callCount).toBe(1);
  });

  it('LLM judge fails when score below threshold', async () => {
    const judge = new MockLLMJudge(0.3);
    const engine = new VerificationEngine();
    engine.registerLLMJudge(judge);

    const spec: ExtendedVerificationSpec = {
      method: 'llm_judge',
      prompt: 'Is this code review thorough?',
      criteria: ['completeness'],
      passingScore: 0.7,
    };
    const result = await engine.verify({ approved: false }, spec);
    expect(result.passed).toBe(false);
  });

  it('human review with mock adapter (approval)', async () => {
    const review = new MockHumanReview();
    review.setDefaultDecision({ passed: true, score: 0.95, details: 'Approved' });
    const engine = new VerificationEngine();
    engine.registerHumanReview(review);

    const spec: ExtendedVerificationSpec = {
      method: 'human_review',
      reviewerPrincipal: orchestrator.principal.id,
      prompt: 'Please review this output',
      timeoutMs: 5000,
    };
    const result = await engine.verify({ data: 'output' }, spec);
    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThan(0.9);
  });

  it('human review with mock adapter (rejection)', async () => {
    const review = new MockHumanReview();
    review.setDefaultDecision({ passed: false, score: 0.2, details: 'Rejected' });
    const engine = new VerificationEngine();
    engine.registerHumanReview(review);

    const spec: ExtendedVerificationSpec = {
      method: 'human_review',
      reviewerPrincipal: orchestrator.principal.id,
      prompt: 'Please review this output',
      timeoutMs: 5000,
    };
    const result = await engine.verify({ data: 'bad output' }, spec);
    expect(result.passed).toBe(false);
  });

  it('composite verification combining schema + LLM judge', async () => {
    const judge = new MockLLMJudge(0.9);
    const engine = new VerificationEngine();
    engine.registerLLMJudge(judge);

    const spec: ExtendedVerificationSpec = {
      method: 'composite',
      steps: [
        { method: 'schema_match', schema: { type: 'object', properties: { approved: { type: 'boolean' } }, required: ['approved'] } },
        { method: 'llm_judge', prompt: 'Is the review good?', criteria: ['quality'], passingScore: 0.5 },
      ],
      mode: 'all_pass',
    };
    const result = await engine.verify({ approved: true }, spec);
    expect(result.passed).toBe(true);
  });

  it('composite verification fails when one step fails (all_pass)', async () => {
    const judge = new MockLLMJudge(0.9);
    const engine = new VerificationEngine();
    engine.registerLLMJudge(judge);

    const spec: ExtendedVerificationSpec = {
      method: 'composite',
      steps: [
        { method: 'schema_match', schema: { type: 'object', properties: { approved: { type: 'boolean' } }, required: ['approved'] } },
        { method: 'llm_judge', prompt: 'Is the review good?', criteria: ['quality'], passingScore: 0.5 },
      ],
      mode: 'all_pass',
    };
    const result = await engine.verify({ notApproved: true }, spec);
    expect(result.passed).toBe(false);
  });

  it('composite majority mode passes when majority passes', async () => {
    const judge = new MockLLMJudge(0.9);
    const engine = new VerificationEngine();
    engine.registerLLMJudge(judge);

    const spec: ExtendedVerificationSpec = {
      method: 'composite',
      steps: [
        { method: 'schema_match', schema: { type: 'array' } },
        { method: 'llm_judge', prompt: 'Q1', criteria: ['c1'], passingScore: 0.5 },
        { method: 'llm_judge', prompt: 'Q2', criteria: ['c2'], passingScore: 0.5 },
      ],
      mode: 'majority',
    };
    const result = await engine.verify({ data: 'test' }, spec);
    expect(result.passed).toBe(true);
  });

  it('trust engine cold start score for new agents', () => {
    const trustEngine = new TrustEngine();
    const newAgent = generateKeypair('NewAgent');
    const score = trustEngine.getScore(newAgent.principal.id);
    expect(score.composite).toBe(0.5);
    expect(score.totalOutcomes).toBe(0);
    expect(score.confidence).toBeLessThan(0.5);
  });

  it('trust score confidence increases with more outcomes', () => {
    const trustEngine = new TrustEngine();
    trustEngine.recordOutcome(goodAgent.principal.id, makeAttestation(goodAgent, 'ct_1', true, 0.8));
    const scoreAfter1 = trustEngine.getScore(goodAgent.principal.id);

    for (let i = 2; i <= 10; i++) {
      trustEngine.recordOutcome(goodAgent.principal.id, makeAttestation(goodAgent, `ct_${i}`, true, 0.8));
    }
    const scoreAfter10 = trustEngine.getScore(goodAgent.principal.id);
    expect(scoreAfter10.confidence).toBeGreaterThan(scoreAfter1.confidence);
    expect(scoreAfter10.totalOutcomes).toBe(10);
  });
});
