/**
 * Cryptographic utilities for DelegateOS.
 * Uses @noble/ed25519 for signing and blakejs for hashing.
 */

import * as ed from '@noble/ed25519';
import { blake2b } from 'blakejs';
import canonicalizeJson from 'canonicalize';
import { sha512 } from '@noble/hashes/sha2.js';
import type { Keypair, Principal } from './types.js';

// ed25519 v2 requires setting the sha512 hash
ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

/** Base64url encode (no padding) */
export function toBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Base64url decode */
export function fromBase64url(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Generate an Ed25519 keypair */
export function generateKeypair(name?: string): Keypair {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = ed.getPublicKey(privateKey);
  const principal: Principal = {
    id: toBase64url(publicKey),
    ...(name ? { name } : {}),
  };
  return { principal, privateKey };
}

/** Sign a message with Ed25519 */
export function sign(privateKey: Uint8Array, message: Uint8Array): Uint8Array {
  return ed.sign(message, privateKey);
}

/** Verify an Ed25519 signature */
export function verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  try {
    return ed.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}

/** BLAKE2b-256 hash */
export function blake2b256(data: Uint8Array): Uint8Array {
  return blake2b(data, undefined, 32);
}

/** Canonical JSON (RFC 8785) */
export function canonicalize(obj: unknown): string {
  const result = canonicalizeJson(obj);
  if (result === undefined) {
    throw new Error('Failed to canonicalize object');
  }
  return result;
}

/** Derive principal ID from a public key */
export function principalId(publicKey: Uint8Array): string {
  return toBase64url(publicKey);
}

/** Sign a canonical JSON object: canonicalize → BLAKE2b → Ed25519 sign */
export function signObject(privateKey: Uint8Array, obj: unknown): string {
  const payload = new TextEncoder().encode(canonicalize(obj));
  const hash = blake2b256(payload);
  const sig = sign(privateKey, hash);
  return toBase64url(sig);
}

/** Verify signature over a canonical JSON object */
export function verifyObjectSignature(publicKeyB64: string, obj: unknown, signatureB64: string): boolean {
  const publicKey = fromBase64url(publicKeyB64);
  const signature = fromBase64url(signatureB64);
  const payload = new TextEncoder().encode(canonicalize(obj));
  const hash = blake2b256(payload);
  return verify(publicKey, hash, signature);
}
