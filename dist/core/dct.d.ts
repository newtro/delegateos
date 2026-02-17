/**
 * DCT Engine — Delegation Capability Token creation, attenuation, and verification.
 * Implements the Signed JSON Token (SJT) format for v0.1.
 */
import type { DCTCreateParams, DCTAttenuateParams, SerializedDCT, VerificationContext, AuthorizedScope, DenialReason, Result, Capability, SignedJSONToken } from './types.js';
/**
 * Create a new DCT (root token).
 * @param params - Token creation parameters
 * @returns Serialized DCT
 */
export declare function createDCT(params: DCTCreateParams): SerializedDCT;
/**
 * Attenuate a DCT — create a narrower child token.
 * @param params - Attenuation parameters
 * @returns New serialized DCT with reduced scope
 */
export declare function attenuateDCT(params: DCTAttenuateParams): SerializedDCT;
/**
 * Verify a DCT against a verification context.
 * @param serialized - The serialized DCT to verify
 * @param context - Verification context (resource, operation, time, budget, etc.)
 * @returns Result with authorized scope or denial reason
 */
export declare function verifyDCT(serialized: SerializedDCT, context: VerificationContext): Result<AuthorizedScope, DenialReason>;
/**
 * Inspect a DCT without verifying signatures.
 * @param serialized - The serialized DCT
 * @returns Token metadata
 */
export declare function inspectDCT(serialized: SerializedDCT): {
    issuer: string;
    delegatee: string;
    contractId: string;
    delegationId: string;
    capabilities: Capability[];
    expiresAt: string;
    chainDepth: number;
    revocationIds: string[];
};
/**
 * Get all revocation IDs for a token (one per block).
 * @param serialized - The serialized DCT
 * @returns Array of revocation IDs
 */
export declare function getRevocationIds(serialized: SerializedDCT): string[];
declare function serialize(token: SignedJSONToken): SerializedDCT;
declare function deserialize(serialized: SerializedDCT): SignedJSONToken;
/** Simple glob matching: * = one segment, ** = any segments */
declare function matchGlob(pattern: string, value: string): boolean;
export { deserialize as _deserialize, serialize as _serialize, matchGlob as _matchGlob };
