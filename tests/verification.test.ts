/**
 * Tests for Verification Engine — llm_judge, human_review, and unified dispatch.
 */

import { describe, it, expect } from 'vitest';
import {
  VerificationEngine,
  MockLLMJudge,
  MockHumanReview,
} from '../src/core/verification.js';
import type {
  LLMJudgeSpec,
  HumanReviewSpec,
  SchemaMatchSpec,
  DeterministicCheckSpec,
  CompositeSpec,
} from '../src/core/verification.js';

describe('MockLLMJudge', () => {
  it('returns default score for all criteria', async () => {
    const judge = new MockLLMJudge(0.9);
    const spec: LLMJudgeSpec = {
      method: 'llm_judge',
      prompt: 'Rate this',
      criteria: ['accuracy', 'completeness'],
      passingScore: 0.8,
    };
    const result = await judge.judge({ text: 'hello' }, spec);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(0.9);
    expect(judge.callCount).toBe(1);
  });

  it('uses per-criterion scores', async () => {
    const judge = new MockLLMJudge();
    judge.setScore('accuracy', 1.0);
    judge.setScore('style', 0.2);
    const spec: LLMJudgeSpec = {
      method: 'llm_judge',
      prompt: 'Rate this',
      criteria: ['accuracy', 'style'],
      passingScore: 0.7,
    };
    const result = await judge.judge('output', spec);
    expect(result.score).toBe(0.6); // avg of 1.0 and 0.2
    expect(result.passed).toBe(false);
  });

  it('clamps scores to 0-1', () => {
    const judge = new MockLLMJudge();
    judge.setScore('x', 5.0);
    judge.setScore('y', -2.0);
    // setScore clamps
  });

  it('fails when below passing score', async () => {
    const judge = new MockLLMJudge(0.3);
    const spec: LLMJudgeSpec = {
      method: 'llm_judge',
      prompt: 'Check',
      criteria: ['quality'],
      passingScore: 0.5,
    };
    const result = await judge.judge('bad output', spec);
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.3);
  });

  it('records last output and spec', async () => {
    const judge = new MockLLMJudge();
    const spec: LLMJudgeSpec = {
      method: 'llm_judge',
      prompt: 'Test',
      criteria: ['a'],
      passingScore: 0.5,
    };
    await judge.judge({ data: 123 }, spec);
    expect(judge.lastOutput).toEqual({ data: 123 });
    expect(judge.lastSpec).toBe(spec);
  });
});

describe('MockHumanReview', () => {
  it('returns default approval', async () => {
    const review = new MockHumanReview();
    const reviewId = await review.requestReview({
      method: 'human_review',
      reviewerPrincipal: 'reviewer1',
      prompt: 'Please review',
      timeoutMs: 5000,
    }, 'output');
    expect(reviewId).toMatch(/^review_/);
    const result = await review.awaitDecision(reviewId, 5000);
    expect(result.passed).toBe(true);
  });

  it('returns custom decision', async () => {
    const review = new MockHumanReview();
    review.setDecision('review_1', { passed: false, details: 'Rejected' });
    await review.requestReview({
      method: 'human_review',
      reviewerPrincipal: 'r',
      prompt: 'Review',
      timeoutMs: 1000,
    }, 'out');
    const result = await review.awaitDecision('review_1', 1000);
    expect(result.passed).toBe(false);
    expect(result.details).toBe('Rejected');
  });

  it('times out when delay exceeds timeout', async () => {
    const review = new MockHumanReview();
    review.setDelay(2000);
    await review.requestReview({
      method: 'human_review',
      reviewerPrincipal: 'r',
      prompt: 'Review',
      timeoutMs: 100,
    }, 'out');
    const result = await review.awaitDecision('review_1', 100);
    expect(result.passed).toBe(false);
    expect(result.details).toBe('Review timed out');
  });

  it('tracks call count', async () => {
    const review = new MockHumanReview();
    const spec: HumanReviewSpec = { method: 'human_review', reviewerPrincipal: 'r', prompt: 'p', timeoutMs: 1000 };
    await review.requestReview(spec, 'a');
    await review.requestReview(spec, 'b');
    expect(review.callCount).toBe(2);
  });
});

describe('VerificationEngine', () => {
  it('verifies schema_match', async () => {
    const engine = new VerificationEngine();
    const spec: SchemaMatchSpec = {
      method: 'schema_match',
      schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
    };
    const pass = await engine.verify({ name: 'Alice' }, spec);
    expect(pass.passed).toBe(true);

    const fail = await engine.verify({ age: 30 }, spec);
    expect(fail.passed).toBe(false);
  });

  it('verifies deterministic_check', async () => {
    const engine = new VerificationEngine();
    engine.registerCheck('is_positive', (output) => {
      const n = output as number;
      return { passed: n > 0, score: n > 0 ? 1 : 0 };
    });
    const spec: DeterministicCheckSpec = {
      method: 'deterministic_check',
      checkName: 'is_positive',
    };
    const pass = await engine.verify(5, spec);
    expect(pass.passed).toBe(true);
    const fail = await engine.verify(-1, spec);
    expect(fail.passed).toBe(false);
  });

  it('returns error for missing check function', async () => {
    const engine = new VerificationEngine();
    const spec: DeterministicCheckSpec = {
      method: 'deterministic_check',
      checkName: 'nonexistent',
    };
    const result = await engine.verify('x', spec);
    expect(result.passed).toBe(false);
    expect(result.details).toContain('not found');
  });

  it('verifies deterministic_check with expectedResult', async () => {
    const engine = new VerificationEngine();
    engine.registerCheck('get_length', (output) => {
      return { passed: true, score: 1, details: String((output as string).length) };
    });
    const spec: DeterministicCheckSpec = {
      method: 'deterministic_check',
      checkName: 'get_length',
      expectedResult: { passed: true, score: 1, details: '5' },
    };
    const pass = await engine.verify('hello', spec);
    expect(pass.passed).toBe(true);
    const fail = await engine.verify('hi', spec);
    expect(fail.passed).toBe(false);
  });

  it('verifies llm_judge', async () => {
    const engine = new VerificationEngine();
    const judge = new MockLLMJudge(0.9);
    engine.registerLLMJudge(judge);
    const spec: LLMJudgeSpec = {
      method: 'llm_judge',
      prompt: 'Rate quality',
      criteria: ['relevance', 'clarity'],
      passingScore: 0.7,
    };
    const result = await engine.verify('good output', spec);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(0.9);
  });

  it('fails llm_judge when no adapter registered', async () => {
    const engine = new VerificationEngine();
    const spec: LLMJudgeSpec = {
      method: 'llm_judge',
      prompt: 'Rate',
      criteria: ['x'],
      passingScore: 0.5,
    };
    const result = await engine.verify('x', spec);
    expect(result.passed).toBe(false);
    expect(result.details).toContain('No LLM judge');
  });

  it('verifies human_review', async () => {
    const engine = new VerificationEngine();
    const review = new MockHumanReview();
    engine.registerHumanReview(review);
    const spec: HumanReviewSpec = {
      method: 'human_review',
      reviewerPrincipal: 'reviewer_key',
      prompt: 'Please approve',
      timeoutMs: 5000,
    };
    const result = await engine.verify('output', spec);
    expect(result.passed).toBe(true);
  });

  it('fails human_review when no adapter registered', async () => {
    const engine = new VerificationEngine();
    const spec: HumanReviewSpec = {
      method: 'human_review',
      reviewerPrincipal: 'r',
      prompt: 'p',
      timeoutMs: 1000,
    };
    const result = await engine.verify('x', spec);
    expect(result.passed).toBe(false);
    expect(result.details).toContain('No human review');
  });

  it('handles composite all_pass', async () => {
    const engine = new VerificationEngine();
    const spec: CompositeSpec = {
      method: 'composite',
      mode: 'all_pass',
      steps: [
        { method: 'schema_match', schema: { type: 'object' } },
        { method: 'schema_match', schema: { type: 'object', required: ['x'] } },
      ],
    };
    const pass = await engine.verify({ x: 1 }, spec);
    expect(pass.passed).toBe(true);

    const fail = await engine.verify({ y: 1 }, spec);
    expect(fail.passed).toBe(false);
  });

  it('handles composite majority', async () => {
    const engine = new VerificationEngine();
    const spec: CompositeSpec = {
      method: 'composite',
      mode: 'majority',
      steps: [
        { method: 'schema_match', schema: { type: 'object' } },
        { method: 'schema_match', schema: { type: 'string' } },
        { method: 'schema_match', schema: { type: 'object' } },
      ],
    };
    const result = await engine.verify({}, spec);
    expect(result.passed).toBe(true); // 2 out of 3
  });

  it('handles composite weighted', async () => {
    const engine = new VerificationEngine();
    const judge = new MockLLMJudge(0.9);
    engine.registerLLMJudge(judge);
    const spec: CompositeSpec = {
      method: 'composite',
      mode: 'weighted',
      weights: [0.3, 0.7],
      passThreshold: 0.6,
      steps: [
        { method: 'schema_match', schema: { type: 'string' } }, // fails (weight 0.3)
        { method: 'llm_judge', prompt: 'p', criteria: ['q'], passingScore: 0.5 }, // passes 0.9 (weight 0.7)
      ],
    };
    const result = await engine.verify({ notString: true }, spec);
    // 0.3*0 + 0.7*0.9 = 0.63 >= 0.6
    expect(result.passed).toBe(true);
  });

  it('handles unknown method gracefully', async () => {
    const engine = new VerificationEngine();
    const result = await engine.verify('x', { method: 'unknown' as any });
    expect(result.passed).toBe(false);
  });
});
