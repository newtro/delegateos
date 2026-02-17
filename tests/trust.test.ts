import { describe, it, expect } from 'vitest';
import { TrustEngine } from '../src/core/trust.js';
import type { Attestation } from '../src/core/types.js';

function makeAttestation(overrides: Partial<Attestation> = {}): Attestation {
  return {
    id: 'att_test',
    version: '0.1',
    contractId: 'ct_test',
    delegationId: 'del_test',
    principal: 'principal_test',
    createdAt: new Date().toISOString(),
    type: 'completion',
    result: {
      success: true,
      costMicrocents: 1000,
      durationMs: 5000,
      verificationOutcome: { method: 'schema_match', passed: true, score: 0.9 },
    },
    childAttestations: [],
    signature: 'sig',
    ...overrides,
  };
}

describe('TrustEngine', () => {
  it('returns cold-start score for unknown principal', () => {
    const engine = new TrustEngine();
    const score = engine.getScore('unknown');
    expect(score.composite).toBe(0.5);
    expect(score.confidence).toBe(0);
    expect(score.totalOutcomes).toBe(0);
  });

  it('records outcome and updates score', () => {
    const engine = new TrustEngine();
    engine.recordOutcome('agent1', makeAttestation());
    const score = engine.getScore('agent1');
    expect(score.totalOutcomes).toBe(1);
    expect(score.composite).toBeGreaterThan(0.5);
    expect(score.reliability).toBe(1);
  });

  it('failed outcomes reduce reliability', () => {
    const engine = new TrustEngine();
    engine.recordOutcome('agent1', makeAttestation());
    engine.recordOutcome('agent1', makeAttestation({
      result: { success: false, costMicrocents: 0, durationMs: 1000 },
    }));
    const score = engine.getScore('agent1');
    expect(score.reliability).toBe(0.5);
  });

  it('quality score reflects verification score', () => {
    const engine = new TrustEngine();
    engine.recordOutcome('agent1', makeAttestation({
      result: {
        success: true, costMicrocents: 0, durationMs: 1000,
        verificationOutcome: { method: 'test', passed: true, score: 0.6 },
      },
    }));
    const score = engine.getScore('agent1');
    expect(score.quality).toBeCloseTo(0.6, 1);
  });

  it('speed score rewards fast agents', () => {
    const engine = new TrustEngine({ expectedDurationMs: 10000 });
    engine.recordOutcome('fast', makeAttestation({
      result: { success: true, costMicrocents: 0, durationMs: 5000 },
    }));
    engine.recordOutcome('slow', makeAttestation({
      result: { success: true, costMicrocents: 0, durationMs: 50000 },
    }));
    const fast = engine.getScore('fast');
    const slow = engine.getScore('slow');
    expect(fast.speed).toBeGreaterThan(slow.speed);
  });

  it('confidence increases with more outcomes', () => {
    const engine = new TrustEngine({ minOutcomesForConfidence: 5 });
    engine.recordOutcome('agent1', makeAttestation());
    expect(engine.getScore('agent1').confidence).toBe(0.2);
    for (let i = 0; i < 4; i++) {
      engine.recordOutcome('agent1', makeAttestation());
    }
    expect(engine.getScore('agent1').confidence).toBe(1);
  });

  it('meetsThreshold works correctly', () => {
    const engine = new TrustEngine();
    expect(engine.meetsThreshold('unknown', 0.5)).toBe(true);
    expect(engine.meetsThreshold('unknown', 0.6)).toBe(false);
    engine.recordOutcome('agent1', makeAttestation());
    expect(engine.meetsThreshold('agent1', 0.5)).toBe(true);
  });

  it('exponential decay weights recent outcomes more', () => {
    const engine = new TrustEngine({ halfLifeMs: 1000 });
    const old = new Date(Date.now() - 10000).toISOString();
    const recent = new Date().toISOString();

    engine.recordOutcome('agent1', makeAttestation({
      createdAt: old,
      result: { success: false, costMicrocents: 0, durationMs: 1000 },
    }));
    engine.recordOutcome('agent1', makeAttestation({
      createdAt: recent,
      result: { success: true, costMicrocents: 0, durationMs: 1000,
        verificationOutcome: { method: 'test', passed: true, score: 1 } },
    }));

    const score = engine.getScore('agent1');
    // Recent success should dominate over old failure
    expect(score.reliability).toBeGreaterThan(0.8);
  });

  it('getProfile returns null for unknown', () => {
    const engine = new TrustEngine();
    expect(engine.getProfile('unknown')).toBeNull();
  });

  it('loadProfile restores state', () => {
    const engine = new TrustEngine();
    engine.loadProfile({
      principalId: 'loaded',
      outcomes: [{
        timestamp: new Date().toISOString(),
        success: true,
        qualityScore: 0.8,
        durationMs: 5000,
        contractId: 'ct_1',
        attestationId: 'att_1',
      }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const score = engine.getScore('loaded');
    expect(score.totalOutcomes).toBe(1);
    expect(score.quality).toBeCloseTo(0.8, 1);
  });

  it('composite is weighted average of components', () => {
    const engine = new TrustEngine({ expectedDurationMs: 1000 });
    engine.recordOutcome('agent1', makeAttestation({
      result: {
        success: true, costMicrocents: 0, durationMs: 1000,
        verificationOutcome: { method: 'test', passed: true, score: 1 },
      },
    }));
    const score = engine.getScore('agent1');
    // composite = 0.4*reliability + 0.4*quality + 0.2*speed
    const expected = 0.4 * score.reliability + 0.4 * score.quality + 0.2 * score.speed;
    expect(score.composite).toBeCloseTo(expected, 5);
  });
});
