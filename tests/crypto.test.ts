import { describe, it, expect } from 'vitest';
import {
  generateKeypair,
  sign,
  verify,
  blake2b256,
  canonicalize,
  signObject,
  verifyObjectSignature,
  toBase64url,
  fromBase64url,
  principalId,
} from '../src/core/crypto.js';

describe('Crypto Utilities', () => {
  describe('base64url', () => {
    it('should round-trip encode/decode', () => {
      const original = new Uint8Array([0, 1, 2, 255, 254, 253]);
      const encoded = toBase64url(original);
      const decoded = fromBase64url(encoded);
      expect(decoded).toEqual(original);
    });

    it('should produce URL-safe characters (no +, /, =)', () => {
      const bytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) bytes[i] = i * 8;
      const encoded = toBase64url(bytes);
      expect(encoded).not.toMatch(/[+/=]/);
    });

    it('should handle empty input', () => {
      const encoded = toBase64url(new Uint8Array(0));
      const decoded = fromBase64url(encoded);
      expect(decoded.length).toBe(0);
    });
  });

  describe('generateKeypair', () => {
    it('should produce unique keypairs', () => {
      const a = generateKeypair();
      const b = generateKeypair();
      expect(a.principal.id).not.toBe(b.principal.id);
    });

    it('should set name when provided', () => {
      const kp = generateKeypair('alice');
      expect(kp.principal.name).toBe('alice');
    });

    it('should not set name when not provided', () => {
      const kp = generateKeypair();
      expect(kp.principal.name).toBeUndefined();
    });

    it('should have 64-byte private key', () => {
      const kp = generateKeypair();
      expect(kp.privateKey.length).toBe(32);
    });
  });

  describe('sign and verify', () => {
    it('should verify a valid signature', () => {
      const kp = generateKeypair();
      const msg = new TextEncoder().encode('hello');
      const sig = sign(kp.privateKey, msg);
      const pub = fromBase64url(kp.principal.id);
      expect(verify(pub, msg, sig)).toBe(true);
    });

    it('should reject wrong message', () => {
      const kp = generateKeypair();
      const msg = new TextEncoder().encode('hello');
      const sig = sign(kp.privateKey, msg);
      const pub = fromBase64url(kp.principal.id);
      const wrong = new TextEncoder().encode('world');
      expect(verify(pub, wrong, sig)).toBe(false);
    });

    it('should reject wrong key', () => {
      const kp1 = generateKeypair();
      const kp2 = generateKeypair();
      const msg = new TextEncoder().encode('hello');
      const sig = sign(kp1.privateKey, msg);
      const pub2 = fromBase64url(kp2.principal.id);
      expect(verify(pub2, msg, sig)).toBe(false);
    });

    it('should return false for garbage signature', () => {
      const kp = generateKeypair();
      const msg = new TextEncoder().encode('hello');
      const pub = fromBase64url(kp.principal.id);
      expect(verify(pub, msg, new Uint8Array(64))).toBe(false);
    });
  });

  describe('blake2b256', () => {
    it('should produce 32-byte hash', () => {
      const hash = blake2b256(new TextEncoder().encode('test'));
      expect(hash.length).toBe(32);
    });

    it('should be deterministic', () => {
      const a = blake2b256(new TextEncoder().encode('same'));
      const b = blake2b256(new TextEncoder().encode('same'));
      expect(a).toEqual(b);
    });

    it('should differ for different inputs', () => {
      const a = blake2b256(new TextEncoder().encode('a'));
      const b = blake2b256(new TextEncoder().encode('b'));
      expect(toBase64url(a)).not.toBe(toBase64url(b));
    });
  });

  describe('canonicalize', () => {
    it('should produce consistent key ordering', () => {
      const a = canonicalize({ b: 2, a: 1 });
      const b = canonicalize({ a: 1, b: 2 });
      expect(a).toBe(b);
    });

    it('should throw for undefined', () => {
      expect(() => canonicalize(undefined)).toThrow();
    });
  });

  describe('signObject / verifyObjectSignature', () => {
    it('should sign and verify an object', () => {
      const kp = generateKeypair();
      const obj = { foo: 'bar', n: 42 };
      const sig = signObject(kp.privateKey, obj);
      expect(verifyObjectSignature(kp.principal.id, obj, sig)).toBe(true);
    });

    it('should reject tampered object', () => {
      const kp = generateKeypair();
      const obj = { foo: 'bar' };
      const sig = signObject(kp.privateKey, obj);
      expect(verifyObjectSignature(kp.principal.id, { foo: 'baz' }, sig)).toBe(false);
    });
  });

  describe('principalId', () => {
    it('should match keypair principal id', () => {
      const kp = generateKeypair();
      const pub = fromBase64url(kp.principal.id);
      expect(principalId(pub)).toBe(kp.principal.id);
    });
  });
});
