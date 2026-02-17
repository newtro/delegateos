/**
 * Trust/Reputation Scoring Engine
 * Tracks agent outcomes and computes composite trust scores with exponential decay.
 */

import type {
  TrustProfile,
  TrustScore,
  TrustEngineConfig,
  TrustOutcome,
  Attestation,
} from './types.js';

const DEFAULT_CONFIG: TrustEngineConfig = {
  halfLifeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  expectedDurationMs: 60_000,
  minOutcomesForConfidence: 10,
  coldStartScore: 0.5,
};

/**
 * Trust/Reputation engine that computes composite trust scores
 * based on historical outcomes with exponential time decay.
 */
export class TrustEngine {
  private profiles: Map<string, TrustProfile> = new Map();
  private config: TrustEngineConfig;

  /**
   * Create a new trust engine.
   * @param config - Optional partial config to override defaults
   */
  constructor(config?: Partial<TrustEngineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record an outcome from an attestation for a principal.
   */
  recordOutcome(principalId: string, attestation: Attestation): void {
    let profile = this.profiles.get(principalId);
    if (!profile) {
      profile = {
        principalId,
        outcomes: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    const outcome: TrustOutcome = {
      timestamp: attestation.createdAt,
      success: attestation.result.success,
      qualityScore: attestation.result.verificationOutcome?.score ?? (attestation.result.success ? 1 : 0),
      durationMs: attestation.result.durationMs,
      contractId: attestation.contractId,
      attestationId: attestation.id,
    };

    profile.outcomes.push(outcome);
    profile.updatedAt = new Date().toISOString();
    this.profiles.set(principalId, profile);
  }

  /**
   * Get the trust score for a principal.
   */
  getScore(principalId: string, now?: string): TrustScore {
    const profile = this.profiles.get(principalId);
    if (!profile || profile.outcomes.length === 0) {
      return {
        composite: this.config.coldStartScore,
        reliability: this.config.coldStartScore,
        quality: this.config.coldStartScore,
        speed: this.config.coldStartScore,
        confidence: 0,
        totalOutcomes: 0,
      };
    }

    const nowMs = now ? new Date(now).getTime() : Date.now();
    const lambda = Math.LN2 / this.config.halfLifeMs;

    // Compute weights via exponential decay
    const weighted = profile.outcomes.map(o => {
      const age = nowMs - new Date(o.timestamp).getTime();
      const weight = Math.exp(-lambda * Math.max(0, age));
      return { outcome: o, weight };
    });

    const totalWeight = weighted.reduce((s, w) => s + w.weight, 0);
    if (totalWeight === 0) {
      return {
        composite: this.config.coldStartScore,
        reliability: this.config.coldStartScore,
        quality: this.config.coldStartScore,
        speed: this.config.coldStartScore,
        confidence: 0,
        totalOutcomes: profile.outcomes.length,
      };
    }

    // Reliability: weighted success rate
    const reliability = weighted.reduce((s, w) => s + (w.outcome.success ? w.weight : 0), 0) / totalWeight;

    // Quality: weighted average quality score
    const quality = weighted.reduce((s, w) => s + w.outcome.qualityScore * w.weight, 0) / totalWeight;

    // Speed: weighted average of speed scores (faster = higher score)
    const speed = weighted.reduce((s, w) => {
      const speedScore = Math.min(1, this.config.expectedDurationMs / Math.max(1, w.outcome.durationMs));
      return s + speedScore * w.weight;
    }, 0) / totalWeight;

    // Confidence: ramps up with number of outcomes
    const confidence = Math.min(1, profile.outcomes.length / this.config.minOutcomesForConfidence);

    // Composite: weighted average of components
    const composite = reliability * 0.4 + quality * 0.4 + speed * 0.2;

    return {
      composite: clamp(composite),
      reliability: clamp(reliability),
      quality: clamp(quality),
      speed: clamp(speed),
      confidence: clamp(confidence),
      totalOutcomes: profile.outcomes.length,
    };
  }

  /**
   * Check if a principal meets a minimum trust score.
   */
  meetsThreshold(principalId: string, minScore: number, now?: string): boolean {
    return this.getScore(principalId, now).composite >= minScore;
  }

  /**
   * Get the raw trust profile.
   */
  getProfile(principalId: string): TrustProfile | null {
    return this.profiles.get(principalId) ?? null;
  }

  /**
   * Load a profile (e.g. from storage).
   */
  loadProfile(profile: TrustProfile): void {
    this.profiles.set(profile.principalId, profile);
  }
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}
