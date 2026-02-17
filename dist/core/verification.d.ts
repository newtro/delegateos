/**
 * Verification Engine — Unified verification dispatcher for all methods.
 * Extends the existing VerificationSpec system with llm_judge and human_review.
 */
import type { CheckResult, CheckFunction } from './types.js';
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
export type ExtendedVerificationSpec = SchemaMatchSpec | DeterministicCheckSpec | CompositeSpec | LLMJudgeSpec | HumanReviewSpec;
/** Adapter for LLM-based judging — plug in any LLM provider */
export interface LLMJudgeAdapter {
    judge(output: unknown, spec: LLMJudgeSpec): Promise<CheckResult>;
}
/** Adapter for human review workflows */
export interface HumanReviewAdapter {
    requestReview(spec: HumanReviewSpec, output: unknown): Promise<string>;
    awaitDecision(reviewId: string, timeoutMs: number): Promise<CheckResult>;
}
/** Mock LLM judge for testing — returns configurable scores per criterion */
export declare class MockLLMJudge implements LLMJudgeAdapter {
    private scores;
    private defaultScore;
    callCount: number;
    lastOutput: unknown;
    lastSpec: LLMJudgeSpec | undefined;
    constructor(defaultScore?: number);
    /** Set score for a specific criterion */
    setScore(criterion: string, score: number): void;
    /** Set default score for all criteria */
    setDefaultScore(score: number): void;
    judge(output: unknown, spec: LLMJudgeSpec): Promise<CheckResult>;
}
/** Mock human review for testing — auto-resolves with configurable results */
export declare class MockHumanReview implements HumanReviewAdapter {
    private decisions;
    private nextReviewId;
    private delayMs;
    private defaultDecision;
    callCount: number;
    lastSpec: HumanReviewSpec | undefined;
    /** Set the result for a specific review ID */
    setDecision(reviewId: string, result: CheckResult): void;
    /** Set the default decision for all reviews */
    setDefaultDecision(result: CheckResult): void;
    /** Set simulated delay in ms */
    setDelay(ms: number): void;
    requestReview(spec: HumanReviewSpec, _output: unknown): Promise<string>;
    awaitDecision(reviewId: string, timeoutMs: number): Promise<CheckResult>;
}
/**
 * Unified verification engine that dispatches to the right verifier based on method.
 * Supports: schema_match, deterministic_check, composite, llm_judge, human_review.
 */
export declare class VerificationEngine {
    private checks;
    private llmJudge;
    private humanReview;
    /** Register an LLM judge adapter */
    registerLLMJudge(adapter: LLMJudgeAdapter): void;
    /** Register a human review adapter */
    registerHumanReview(adapter: HumanReviewAdapter): void;
    /** Register a named check function */
    registerCheck(name: string, fn: CheckFunction): void;
    /**
     * Verify output against a verification spec.
     */
    verify(output: unknown, spec: ExtendedVerificationSpec): Promise<CheckResult>;
    private verifySchema;
    private verifyDeterministic;
    private verifyComposite;
    private verifyLLMJudge;
    private verifyHumanReview;
}
