/**
 * Biscuit Token Backend — Datalog-based capability authorization engine.
 * Implements a minimal Datalog evaluator and a DCT engine using Biscuit-compatible token format.
 */
import type { DCTCreateParams, DCTAttenuateParams, SerializedDCT, VerificationContext, AuthorizedScope, DenialReason, Result } from './types.js';
export interface Fact {
    name: string;
    terms: string[];
}
export interface Rule {
    head: Fact;
    body: Fact[];
    constraints?: Array<{
        variable: string;
        op: '==' | '!=' | '<' | '>' | '<=' | '>=';
        value: string;
    }>;
}
export interface Check {
    /** "check if" — must have at least one matching rule */
    rules: Rule[];
}
export interface Policy {
    kind: 'allow' | 'deny';
    rules: Rule[];
}
export declare class DatalogEvaluator {
    private facts;
    private rules;
    private checks;
    private policies;
    addFact(fact: Fact): void;
    addRule(rule: Rule): void;
    addCheck(check: Check): void;
    addPolicy(policy: Policy): void;
    /**
     * Forward-chaining evaluation: apply rules until no new facts are generated.
     */
    evaluate(): void;
    /**
     * Run all checks. Returns true if all checks pass.
     */
    runChecks(): {
        passed: boolean;
        failedCheck?: number;
    };
    /**
     * Evaluate policies. Returns the first matching policy's kind.
     */
    runPolicies(): 'allow' | 'deny' | null;
    getFacts(): Fact[];
    private hasFact;
    /**
     * Apply a rule against the current fact set, returning generated head facts.
     * Supports joins across multiple body atoms via unification.
     */
    private applyRule;
    /**
     * Recursively match body atoms, building up variable bindings.
     */
    private matchBody;
}
/**
 * Create a Biscuit-format DCT.
 */
export declare function createBiscuitDCT(params: DCTCreateParams): SerializedDCT;
/**
 * Attenuate a Biscuit-format DCT.
 */
export declare function attenuateBiscuitDCT(params: DCTAttenuateParams): SerializedDCT;
/**
 * Verify a Biscuit-format DCT.
 */
export declare function verifyBiscuitDCT(serialized: SerializedDCT, context: VerificationContext): Result<AuthorizedScope, DenialReason>;
export type DCTFormat = 'sjt' | 'biscuit';
/** DCT engine interface returned by the factory */
export interface DCTEngine {
    createDCT: typeof createBiscuitDCT;
    attenuateDCT: typeof attenuateBiscuitDCT;
    verifyDCT: typeof verifyBiscuitDCT;
}
/**
 * Factory for selecting DCT backend (SJT or Biscuit).
 * Both backends implement the same interface for seamless switching.
 */
export declare class DCTEngineFactory {
    /**
     * Create a DCT engine for the given format.
     * @param format - 'sjt' for Signed JSON Tokens, 'biscuit' for Datalog-based tokens
     * @returns DCT engine with create, attenuate, and verify methods
     */
    static create(format: DCTFormat): DCTEngine;
}
