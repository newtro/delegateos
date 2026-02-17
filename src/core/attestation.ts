/**
 * Attestation Engine — Create and verify signed attestations.
 */

import type { Attestation, AttestationResult, Keypair } from './types.js';
import { signObject, verifyObjectSignature } from './crypto.js';

/** Generate an attestation ID */
function generateAttestationId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `att_${hex}`;
}

/**
 * Create a signed completion attestation.
 * @param signer - Keypair of the attesting principal
 * @param contractId - Contract this attestation is for
 * @param delegationId - Delegation this attestation is for
 * @param result - Attestation result data
 * @param childAttestations - IDs of child attestations (for nested chains)
 * @returns Signed Attestation
 */
export function createCompletionAttestation(
  signer: Keypair,
  contractId: string,
  delegationId: string,
  result: AttestationResult,
  childAttestations: string[] = [],
): Attestation {
  const attestation: Attestation = {
    id: generateAttestationId(),
    version: '0.1',
    contractId,
    delegationId,
    principal: signer.principal.id,
    createdAt: new Date().toISOString(),
    type: 'completion',
    result,
    childAttestations,
    signature: '',
  };

  const { signature: _, ...toSign } = attestation;
  attestation.signature = signObject(signer.privateKey, toSign);

  return attestation;
}

/**
 * Create a delegation verification attestation.
 * @param signer - Keypair of the verifying principal
 * @param contractId - Contract being verified
 * @param delegationId - Delegation being verified
 * @param result - Verification result
 * @param childAttestations - Child attestation IDs
 * @returns Signed Attestation
 */
export function createDelegationVerificationAttestation(
  signer: Keypair,
  contractId: string,
  delegationId: string,
  result: AttestationResult,
  childAttestations: string[] = [],
): Attestation {
  const attestation: Attestation = {
    id: generateAttestationId(),
    version: '0.1',
    contractId,
    delegationId,
    principal: signer.principal.id,
    createdAt: new Date().toISOString(),
    type: 'delegation_verification',
    result,
    childAttestations,
    signature: '',
  };

  const { signature: _, ...toSign } = attestation;
  attestation.signature = signObject(signer.privateKey, toSign);

  return attestation;
}

/**
 * Verify an attestation's signature.
 * @param attestation - The attestation to verify
 * @param signerPublicKey - Expected signer's base64url public key
 * @returns true if the signature is valid
 */
export function verifyAttestationSignature(
  attestation: Attestation,
  signerPublicKey: string,
): boolean {
  const { signature, ...toVerify } = attestation;
  return verifyObjectSignature(signerPublicKey, toVerify, signature);
}
