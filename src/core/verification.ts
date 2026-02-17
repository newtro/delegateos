/**
 * Verification Engine — Unified verification dispatcher for all methods.
 * Extends the existing VerificationSpec system with llm_judge and human_review.
 */

import Ajv from 'ajv';
import type {
  CheckResult,
  CheckFunction,
  Result,
} from './types.js';
import { canonicalize } from './crypto.js';

// ── Extended Verification Spec Types ──

export interface LLMJudgeSpec {
  method: 'llm_judge';
  prompt: string;
  criteria: string[];
  passingScore: number;
  model?: string;
}

export interface HumanReviewSpec {
  method: 'human_review';
  reviewerPrincipal: string;
  prompt: string;
  timeoutMs: number;
}

export interface SchemaMatchSpec {
  method: 'schema_match';
  schema: Record<string, unknown>;
}

export interface DeterministicCheckSpec {
  method: 'deterministic_check';
  checkName: string;
  checkParams?: unknown;
  expectedResult?: unknown;
}

export interface CompositeSpec {
  method: 'composite';
  steps: ExtendedVerificationSpec[];
  mode: 'all_pass' | 'majority' | 'weighted';
  weights?: number[];
  passThreshold?: number;
}

export type ExtendedVerificationSpec =
  | SchemaMatchSpec
  | DeterministicCheckSpec
  | CompositeSpec
  | LLMJudgeSpec
  | HumanReviewSpec;

// ── Adapter Interfaces ──

/** Adapter for LLM-based judging — plug in any LLM provider */
export interface LLMJudgeAdapter {
  judge(output: unknown, spec: LLMJudgeSpec): Promise<CheckResult>;
}

/** Adapter for human review workflows */
export interface HumanReviewAdapter {
  requestReview(spec: HumanReviewSpec, output: unknown): Promise<string>;
  awaitDecision(reviewId: string, timeoutMs: number): Promise<CheckResult>;
}

// ── Mock Implementations ──

/** Mock LLM judge for testing — returns configurable scores per criterion */
export class MockLLMJudge implements LLMJudgeAdapter {
  private scores: Map<string, number> = new Map();
  private defaultScore: number;
  public callCount = 0;
  public lastOutput: unknown = undefined;
  public lastSpec: LLMJudgeSpec | undefined = undefined;

  constructor(defaultScore = 0.8) {
    this.defaultScore = defaultScore;
  }

  /** Set score for a specific criterion */
  setScore(criterion: string, score: number): void {
    this.scores.set(criterion, Math.max(0, Math.min(1, score)));
  }

  /** Set default score for all criteria */
  setDefaultScore(score: number): void {
    this.defaultScore = Math.max(0, Math.min(1, score));
  }

  async judge(output: unknown, spec: LLMJudgeSpec): Promise<CheckResult> {
    this.callCount++;
    this.lastOutput = output;
    this.lastSpec = spec;

    const criteriaScores = spec.criteria.map(c => this.scores.get(c) ?? this.defaultScore);
    const avgScore = criteriaScores.reduce((a, b) => a + b, 0) / criteriaScores.length;
    const passed = avgScore >= spec.passingScore;

    return {
      passed,
      score: avgScore,
      details: `Criteria scores: ${spec.criteria.map((c, i) => `${c}=${criteriaScores[i].toFixed(2)}`).join(', ')}`,
    };
  }
}

/** Mock human review for testing — auto-resolves with configurable results */
export class MockHumanReview implements HumanReviewAdapter {
  private decisions: Map<string, CheckResult> = new Map();
  private nextReviewId = 0;
  private delayMs = 0;
  private defaultDecision: CheckResult = { passed: true, score: 1, details: 'Approved by reviewer' };
  public callCount = 0;
  public lastSpec: HumanReviewSpec | undefined = undefined;

  /** Set the result for a specific review ID */
  setDecision(reviewId: string, result: CheckResult): void {
    this.decisions.set(reviewId, result);
  }

  /** Set the default decision for all reviews */
  setDefaultDecision(result: CheckResult): void {
    this.defaultDecision = result;
  }

  /** Set simulated delay in ms */
  setDelay(ms: number): void {
    this.delayMs = ms;
  }

  async requestReview(spec: HumanReviewSpec, _output: unknown): Promise<string> {
    this.callCount++;
    this.lastSpec = spec;
    const reviewId = `review_${++this.nextReviewId}`;
    return reviewId;
  }

  async awaitDecision(reviewId: string, timeoutMs: number): Promise<CheckResult> {
    if (this.delayMs > timeoutMs) {
      return { passed: false, details: 'Review timed out' };
    }

    if (this.delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.delayMs));
    }

    return this.decisions.get(reviewId) ?? this.defaultDecision;
  }
}

// ── Verification Engine ──

const ajv = new Ajv({ strict: false });

/**
 * Unified verification engine that dispatches to the right verifier based on method.
 * Supports: schema_match, deterministic_check, composite, llm_judge, human_review.
 */
export class VerificationEngine {
  private checks: Map<string, CheckFunction> = new Map();
  private llmJudge: LLMJudgeAdapter | null = null;
  private humanReview: HumanReviewAdapter | null = null;

  /** Register an LLM judge adapter */
  registerLLMJudge(adapter: LLMJudgeAdapter): void {
    this.llmJudge = adapter;
  }

  /** Register a human review adapter */
  registerHumanReview(adapter: HumanReviewAdapter): void {
    this.humanReview = adapter;
  }

  /** Register a named check function */
  registerCheck(name: string, fn: CheckFunction): void {
    this.checks.set(name, fn);
  }

  /**
   * Verify output against a verification spec.
   */
  async verify(output: unknown, spec: ExtendedVerificationSpec): Promise<CheckResult> {
    switch (spec.method) {
      case 'schema_match':
        return this.verifySchema(output, spec);
      case 'deterministic_check':
        return this.verifyDeterministic(output, spec);
      case 'composite':
        return this.verifyComposite(output, spec);
      case 'llm_judge':
        return this.verifyLLMJudge(output, spec);
      case 'human_review':
        return this.verifyHumanReview(output, spec);
      default:
        return { passed: false, details: `Unknown verification method: ${(spec as { method: string }).method}` };
    }
  }

  private verifySchema(output: unknown, spec: SchemaMatchSpec): CheckResult {
    const validate = ajv.compile(spec.schema);
    const valid = validate(output);
    return {
      passed: valid as boolean,
      score: valid ? 1 : 0,
      details: valid ? undefined : ajv.errorsText(validate.errors),
    };
  }

  private verifyDeterministic(output: unknown, spec: DeterministicCheckSpec): CheckResult {
    const fn = this.checks.get(spec.checkName);
    if (!fn) {
      return { passed: false, score: 0, details: `Check function not found: ${spec.checkName}` };
    }
    const result = fn(output, spec.checkParams);
    if (spec.expectedResult !== undefined) {
      const passed = canonicalize(result) === canonicalize(spec.expectedResult);
      return { ...result, passed };
    }
    return result;
  }

  private async verifyComposite(output: unknown, spec: CompositeSpec): Promise<CheckResult> {
    const results: CheckResult[] = [];

    for (let i = 0; i < spec.steps.length; i++) {
      const r = await this.verify(output, spec.steps[i]);
      results.push(r);
      if (spec.mode === 'all_pass' && !r.passed) {
        return { passed: false, score: 0, details: `Step ${i} failed: ${r.details ?? 'no details'}` };
      }
    }

    switch (spec.mode) {
      case 'all_pass':
        return { passed: true, score: 1 };

      case 'majority': {
        const passCount = results.filter(r => r.passed).length;
        const score = passCount / results.length;
        return { passed: passCount > results.length / 2, score };
      }

      case 'weighted': {
        if (!spec.weights || spec.weights.length !== spec.steps.length) {
          return { passed: false, score: 0, details: 'weighted mode requires weights matching steps length' };
        }
        const weightedScore = spec.weights.reduce((sum, w, i) => {
          const s = results[i].score ?? (results[i].passed ? 1 : 0);
          return sum + w * s;
        }, 0);
        const threshold = spec.passThreshold ?? 0.7;
        return { passed: weightedScore >= threshold, score: weightedScore };
      }

      default:
        return { passed: false, details: `Unknown composite mode: ${spec.mode}` };
    }
  }

  private async verifyLLMJudge(output: unknown, spec: LLMJudgeSpec): Promise<CheckResult> {
    if (!this.llmJudge) {
      return { passed: false, score: 0, details: 'No LLM judge adapter registered' };
    }
    return this.llmJudge.judge(output, spec);
  }

  private async verifyHumanReview(output: unknown, spec: HumanReviewSpec): Promise<CheckResult> {
    if (!this.humanReview) {
      return { passed: false, score: 0, details: 'No human review adapter registered' };
    }
    const reviewId = await this.humanReview.requestReview(spec, output);
    return this.humanReview.awaitDecision(reviewId, spec.timeoutMs);
  }
}
