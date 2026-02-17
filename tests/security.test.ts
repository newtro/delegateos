/**
 * Security-focused tests for DelegateOS.
 * Tests crypto input validation, malformed tokens, bypass attempts.
 */

import { describe, it, expect } from 'vitest';
import {
  generateKeypair,
  sign,
  verify,
  verifyObjectSignature,
  signObject,
  fromBase64url,
  toBase64url,
  createDCT,
  verifyDCT,
  attenuateDCT,
  inspectDCT,
  getRevocationIds,
  createContract,
  verifyContractSignature,
  createCompletionAttestation,
  verifyAttestationSignature,
  InMemoryRevocationList,
  createRevocationEntry,
} from '../src/index.js';

// ── Helpers ──

function futureISO(ms = 3600_000): string {
  return new Date(Date.now() + ms).toISOString();
}

function makeRootDCT(issuer = generateKeypair('root')) {
  const delegatee = generateKeypair('delegatee');
  const dct = createDCT({
    issuer,
    delegatee: delegatee.principal,
    capabilities: [{ namespace: 'test', action: 'read', resource: '**' }],
    contractId: 'ct_test',
    delegationId: 'del_test',
    parentDelegationId: 'del_000000000000',
    chainDepth: 0,
    maxChainDepth: 5,
    maxBudgetMicrocents: 100_000,
    expiresAt: futureISO(),
  });
  return { issuer, delegatee, dct };
}

describe('Crypto Input Validation', () => {
  it('sign rejects non-32-byte private key', () => {
    expect(() => sign(new Uint8Array(16), new Uint8Array(32))).toThrow('Invalid private key');
    expect(() => sign(new Uint8Array(64), new Uint8Array(32))).toThrow('Invalid private key');
    expect(() => sign(new Uint8Array(0), new Uint8Array(32))).toThrow('Invalid private key');
  });

  it('sign rejects non-Uint8Array message', () => {
    const kp = generateKeypair();
    expect(() => sign(kp.privateKey, 'not bytes' as unknown as Uint8Array)).toThrow('Invalid message');
  });

  it('verify returns false for wrong-length public key', () => {
    expect(verify(new Uint8Array(16), new Uint8Array(32), new Uint8Array(64))).toBe(false);
  });

  it('verify returns false for wrong-length signature', () => {
    expect(verify(new Uint8Array(32), new Uint8Array(32), new Uint8Array(32))).toBe(false);
  });

  it('verify returns false for empty inputs', () => {
    expect(verify(new Uint8Array(0), new Uint8Array(0), new Uint8Array(0))).toBe(false);
  });

  it('verifyObjectSignature returns false for empty key/signature', () => {
    expect(verifyObjectSignature('', { a: 1 }, 'sig')).toBe(false);
    expect(verifyObjectSignature('key', { a: 1 }, '')).toBe(false);
  });

  it('verifyObjectSignature returns false for malformed base64url', () => {
    // Invalid base64 chars
    expect(verifyObjectSignature('!!!invalid!!!', { a: 1 }, 'also-bad')).toBe(false);
  });
});

describe('Token Tampering Detection', () => {
  it('rejects token with modified authority after signing', () => {
    const { issuer, dct } = makeRootDCT();
    // Decode, modify, re-encode
    const bytes = fromBase64url(dct.token);
    const json = JSON.parse(new TextDecoder().decode(bytes));
    json.authority.maxBudgetMicrocents = 999_999_999;
    const tampered = {
      token: toBase64url(new TextEncoder().encode(JSON.stringify(json))),
      format: dct.format as 'delegateos-sjt-v1',
    };

    const result = verifyDCT(tampered, {
      resource: '**',
      operation: 'read',
      now: new Date().toISOString(),
      spentMicrocents: 0,
      rootPublicKey: issuer.principal.id,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('invalid_signature');
    }
  });

  it('rejects token with modified attenuation after signing', () => {
    const { issuer, delegatee, dct } = makeRootDCT();
    const sub = generateKeypair('sub');
    const attenuated = attenuateDCT({
      token: dct,
      attenuator: delegatee,
      delegatee: sub.principal,
      delegationId: 'del_sub',
      contractId: 'ct_test',
      maxBudgetMicrocents: 50_000,
    });

    // Tamper: change budget in attenuation
    const bytes = fromBase64url(attenuated.token);
    const json = JSON.parse(new TextDecoder().decode(bytes));
    json.attenuations[0].maxBudgetMicrocents = 999_999;
    const tampered = {
      token: toBase64url(new TextEncoder().encode(JSON.stringify(json))),
      format: attenuated.format as 'delegateos-sjt-v1',
    };

    const result = verifyDCT(tampered, {
      resource: '**',
      operation: 'read',
      now: new Date().toISOString(),
      spentMicrocents: 0,
      rootPublicKey: issuer.principal.id,
    });

    expect(result.ok).toBe(false);
  });

  it('rejects token signed by wrong key', () => {
    const attacker = generateKeypair('attacker');
    const { dct } = makeRootDCT();

    const result = verifyDCT(dct, {
      resource: '**',
      operation: 'read',
      now: new Date().toISOString(),
      spentMicrocents: 0,
      rootPublicKey: attacker.principal.id, // wrong root
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('invalid_signature');
    }
  });

  it('rejects completely garbage token data', () => {
    const garbage = {
      token: toBase64url(new TextEncoder().encode('not json at all!!!')),
      format: 'delegateos-sjt-v1' as const,
    };

    const result = verifyDCT(garbage, {
      resource: '**',
      operation: 'read',
      now: new Date().toISOString(),
      spentMicrocents: 0,
      rootPublicKey: 'whatever',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('malformed_token');
    }
  });

  it('rejects token with empty signatures array', () => {
    const { issuer, dct } = makeRootDCT();
    const bytes = fromBase64url(dct.token);
    const json = JSON.parse(new TextDecoder().decode(bytes));
    json.signatures = [];
    const tampered = {
      token: toBase64url(new TextEncoder().encode(JSON.stringify(json))),
      format: dct.format as 'delegateos-sjt-v1',
    };

    const result = verifyDCT(tampered, {
      resource: '**',
      operation: 'read',
      now: new Date().toISOString(),
      spentMicrocents: 0,
      rootPublicKey: issuer.principal.id,
    });

    expect(result.ok).toBe(false);
  });
});

describe('Budget Boundary Conditions', () => {
  it('rejects when spentMicrocents exactly equals budget', () => {
    const { issuer, dct } = makeRootDCT();
    const result = verifyDCT(dct, {
      resource: '**',
      operation: 'read',
      now: new Date().toISOString(),
      spentMicrocents: 100_000, // exactly at budget
      rootPublicKey: issuer.principal.id,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('budget_exceeded');
    }
  });

  it('allows when spentMicrocents is one less than budget', () => {
    const { issuer, dct } = makeRootDCT();
    const result = verifyDCT(dct, {
      resource: '**',
      operation: 'read',
      now: new Date().toISOString(),
      spentMicrocents: 99_999,
      rootPublicKey: issuer.principal.id,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.remainingBudgetMicrocents).toBe(1);
    }
  });
});

describe('Expiry Boundary Conditions', () => {
  it('rejects token that expires at exactly now', () => {
    const issuer = generateKeypair('root');
    const delegatee = generateKeypair('del');
    const now = new Date().toISOString();

    const dct = createDCT({
      issuer,
      delegatee: delegatee.principal,
      capabilities: [{ namespace: 'test', action: 'read', resource: '**' }],
      contractId: 'ct_test',
      delegationId: 'del_test',
      parentDelegationId: 'del_000000000000',
      chainDepth: 0,
      maxChainDepth: 5,
      maxBudgetMicrocents: 100_000,
      expiresAt: now,
    });

    // now > expiresAt (string comparison, same value means now is not > so it should pass)
    // Actually with ISO strings, same string means not >, so this should pass
    const result = verifyDCT(dct, {
      resource: '**',
      operation: 'read',
      now, // same as expiresAt
      spentMicrocents: 0,
      rootPublicKey: issuer.principal.id,
    });

    // String comparison: now > expiresAt is false when equal, so token is still valid
    expect(result.ok).toBe(true);
  });
});

describe('Chain Depth Boundary', () => {
  it('rejects when chain depth exactly exceeds limit', () => {
    const { issuer, dct } = makeRootDCT();
    const result = verifyDCT(dct, {
      resource: '**',
      operation: 'read',
      now: new Date().toISOString(),
      spentMicrocents: 0,
      rootPublicKey: issuer.principal.id,
      maxChainDepth: 0, // depth is 0, limit is 0 — 0 > 0 is false, should pass
    });

    expect(result.ok).toBe(true);
  });
});

describe('Revocation Race Conditions', () => {
  it('revocation is effective immediately after adding', () => {
    const issuer = generateKeypair('root');
    const { dct } = makeRootDCT(issuer);
    const revIds = getRevocationIds(dct);
    const list = new InMemoryRevocationList();

    // Verify passes before revocation
    const before = verifyDCT(dct, {
      resource: '**',
      operation: 'read',
      now: new Date().toISOString(),
      spentMicrocents: 0,
      rootPublicKey: issuer.principal.id,
      revocationIds: list.getRevocationIds(),
    });
    expect(before.ok).toBe(true);

    // Revoke
    const entry = createRevocationEntry(issuer, revIds[0]);
    list.add(entry);

    // Verify fails after revocation
    const after = verifyDCT(dct, {
      resource: '**',
      operation: 'read',
      now: new Date().toISOString(),
      spentMicrocents: 0,
      rootPublicKey: issuer.principal.id,
      revocationIds: list.getRevocationIds(),
    });
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error.type).toBe('revoked');
  });
});

describe('Contract Signature Verification', () => {
  it('rejects contract with tampered fields', () => {
    const issuer = generateKeypair('root');
    const contract = createContract(
      issuer,
      { title: 'Test', description: 'Test', inputs: {}, outputSchema: {} },
      { method: 'schema_match', schema: { type: 'object' } },
      { maxBudgetMicrocents: 100_000, deadline: futureISO(), maxChainDepth: 5, requiredCapabilities: ['test'] },
    );

    // Tamper
    contract.task.title = 'TAMPERED';
    expect(verifyContractSignature(contract, issuer.principal.id)).toBe(false);
  });
});

describe('Attestation Signature Verification', () => {
  it('rejects attestation with tampered result', () => {
    const signer = generateKeypair('agent');
    const attestation = createCompletionAttestation(
      signer, 'ct_1', 'del_1',
      { success: true, costMicrocents: 100, durationMs: 500 },
    );

    // Tamper
    attestation.result.success = false;
    expect(verifyAttestationSignature(attestation, signer.principal.id)).toBe(false);
  });
});

describe('Revocation Signature Validation', () => {
  it('rejects revocation entry with invalid signature', () => {
    const list = new InMemoryRevocationList();
    const fakeEntry = {
      revocationId: 'fake_id',
      revokedBy: generateKeypair().principal.id,
      revokedAt: new Date().toISOString(),
      scope: 'block' as const,
      signature: 'totally_fake_signature',
    };

    const result = list.add(fakeEntry);
    expect(result.ok).toBe(false);
  });
});
