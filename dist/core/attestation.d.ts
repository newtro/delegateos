/**
 * Attestation Engine — Create and verify signed attestations.
 */
import type { Attestation, AttestationResult, Keypair } from './types.js';
/**
 * Create a signed completion attestation.
 * @param signer - Keypair of the attesting principal
 * @param contractId - Contract this attestation is for
 * @param delegationId - Delegation this attestation is for
 * @param result - Attestation result data
 * @param childAttestations - IDs of child attestations (for nested chains)
 * @returns Signed Attestation
 */
export declare function createCompletionAttestation(signer: Keypair, contractId: string, delegationId: string, result: AttestationResult, childAttestations?: string[]): Attestation;
/**
 * Create a delegation verification attestation.
 * @param signer - Keypair of the verifying principal
 * @param contractId - Contract being verified
 * @param delegationId - Delegation being verified
 * @param result - Verification result
 * @param childAttestations - Child attestation IDs
 * @returns Signed Attestation
 */
export declare function createDelegationVerificationAttestation(signer: Keypair, contractId: string, delegationId: string, result: AttestationResult, childAttestations?: string[]): Attestation;
/**
 * Verify an attestation's signature.
 * @param attestation - The attestation to verify
 * @param signerPublicKey - Expected signer's base64url public key
 * @returns true if the signature is valid
 */
export declare function verifyAttestationSignature(attestation: Attestation, signerPublicKey: string): boolean;
