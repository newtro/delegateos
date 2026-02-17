/**
 * Cryptographic utilities for DelegateOS.
 * Uses @noble/ed25519 for signing and blakejs for hashing.
 */
import type { Keypair } from './types.js';
/** Base64url encode (no padding) */
export declare function toBase64url(bytes: Uint8Array): string;
/** Base64url decode */
export declare function fromBase64url(str: string): Uint8Array;
/** Generate an Ed25519 keypair */
export declare function generateKeypair(name?: string): Keypair;
/**
 * Sign a message with Ed25519.
 * @param privateKey - 32-byte Ed25519 private key
 * @param message - Message bytes to sign
 * @returns 64-byte Ed25519 signature
 * @throws If privateKey is not 32 bytes
 */
export declare function sign(privateKey: Uint8Array, message: Uint8Array): Uint8Array;
/**
 * Verify an Ed25519 signature.
 * @param publicKey - 32-byte Ed25519 public key
 * @param message - Original message bytes
 * @param signature - 64-byte Ed25519 signature
 * @returns true if signature is valid
 */
export declare function verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean;
/** BLAKE2b-256 hash */
export declare function blake2b256(data: Uint8Array): Uint8Array;
/** Canonical JSON (RFC 8785) */
export declare function canonicalize(obj: unknown): string;
/** Derive principal ID from a public key */
export declare function principalId(publicKey: Uint8Array): string;
/**
 * Sign a canonical JSON object: canonicalize → BLAKE2b → Ed25519 sign.
 * @param privateKey - 32-byte Ed25519 private key
 * @param obj - Object to sign (will be canonicalized)
 * @returns Base64url-encoded signature
 */
export declare function signObject(privateKey: Uint8Array, obj: unknown): string;
/**
 * Verify signature over a canonical JSON object.
 * @param publicKeyB64 - Base64url-encoded Ed25519 public key
 * @param obj - Object that was signed
 * @param signatureB64 - Base64url-encoded signature to verify
 * @returns true if signature is valid
 */
export declare function verifyObjectSignature(publicKeyB64: string, obj: unknown, signatureB64: string): boolean;
