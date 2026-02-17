/**
 * Trust/Reputation Scoring Engine
 * Tracks agent outcomes and computes composite trust scores with exponential decay.
 */
import type { TrustProfile, TrustScore, TrustEngineConfig, Attestation } from './types.js';
/**
 * Trust/Reputation engine that computes composite trust scores
 * based on historical outcomes with exponential time decay.
 */
export declare class TrustEngine {
    private profiles;
    private config;
    private logger;
    /**
     * Create a new trust engine.
     * @param config - Optional partial config to override defaults
     */
    constructor(config?: Partial<TrustEngineConfig>);
    /**
     * Record an outcome from an attestation for a principal.
     */
    recordOutcome(principalId: string, attestation: Attestation): void;
    /**
     * Get the trust score for a principal.
     */
    getScore(principalId: string, now?: string): TrustScore;
    /**
     * Check if a principal meets a minimum trust score.
     */
    meetsThreshold(principalId: string, minScore: number, now?: string): boolean;
    /**
     * Get the raw trust profile.
     */
    getProfile(principalId: string): TrustProfile | null;
    /**
     * Load a profile (e.g. from storage).
     */
    loadProfile(profile: TrustProfile): void;
}
