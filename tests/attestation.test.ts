import { describe, it, expect } from 'vitest';
import { generateKeypair } from '../src/core/crypto.js';
import {
  createCompletionAttestation,
  createDelegationVerificationAttestation,
  verifyAttestationSignature,
} from '../src/core/attestation.js';
import type { AttestationResult } from '../src/core/types.js';

const signer = generateKeypair('signer');
const other = generateKeypair('other');

const result: AttestationResult = {
  success: true,
  output: { answer: 42 },
  outputHash: 'somehash',
  costMicrocents: 50000,
  durationMs: 1500,
  verificationOutcome: {
    method: 'schema_match',
    passed: true,
    score: 1.0,
  },
};

describe('Attestation', () => {
  it('should create and verify a completion attestation', () => {
    const att = createCompletionAttestation(signer, 'ct_test000001', 'del_test000001', result);
    expect(att.id).toMatch(/^att_/);
    expect(att.type).toBe('completion');
    expect(att.version).toBe('0.1');
    expect(att.principal).toBe(signer.principal.id);
    expect(verifyAttestationSignature(att, signer.principal.id)).toBe(true);
  });

  it('should create a delegation verification attestation', () => {
    const att = createDelegationVerificationAttestation(signer, 'ct_test000001', 'del_test000001', result);
    expect(att.type).toBe('delegation_verification');
    expect(verifyAttestationSignature(att, signer.principal.id)).toBe(true);
  });

  it('should reject wrong signer key', () => {
    const att = createCompletionAttestation(signer, 'ct_test000001', 'del_test000001', result);
    expect(verifyAttestationSignature(att, other.principal.id)).toBe(false);
  });

  it('should reject tampered attestation', () => {
    const att = createCompletionAttestation(signer, 'ct_test000001', 'del_test000001', result);
    att.result.costMicrocents = 999999;
    expect(verifyAttestationSignature(att, signer.principal.id)).toBe(false);
  });

  it('should support child attestations', () => {
    const child = createCompletionAttestation(signer, 'ct_test000001', 'del_test000002', result);
    const parent = createCompletionAttestation(signer, 'ct_test000001', 'del_test000001', result, [child.id]);
    expect(parent.childAttestations).toContain(child.id);
    expect(verifyAttestationSignature(parent, signer.principal.id)).toBe(true);
  });

  it('should handle failed result', () => {
    const failResult: AttestationResult = { success: false, costMicrocents: 10000, durationMs: 500 };
    const att = createCompletionAttestation(signer, 'ct_test000001', 'del_test000001', failResult);
    expect(att.result.success).toBe(false);
    expect(verifyAttestationSignature(att, signer.principal.id)).toBe(true);
  });
});
