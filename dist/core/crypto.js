/**
 * Cryptographic utilities for DelegateOS.
 * Uses @noble/ed25519 for signing and blakejs for hashing.
 */
import * as ed from '@noble/ed25519';
import { blake2b } from 'blakejs';
import canonicalizeJson from 'canonicalize';
import { sha512 } from '@noble/hashes/sha2.js';
// ed25519 v2 requires setting the sha512 hash
ed.etc.sha512Sync = (...m) => {
    const h = sha512.create();
    for (const msg of m)
        h.update(msg);
    return h.digest();
};
/** Base64url encode (no padding) */
export function toBase64url(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/** Base64url decode */
export function fromBase64url(str) {
    const padded = str.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
/** Generate an Ed25519 keypair */
export function generateKeypair(name) {
    const privateKey = ed.utils.randomPrivateKey();
    const publicKey = ed.getPublicKey(privateKey);
    const principal = {
        id: toBase64url(publicKey),
        ...(name ? { name } : {}),
    };
    return { principal, privateKey };
}
/**
 * Sign a message with Ed25519.
 * @param privateKey - 32-byte Ed25519 private key
 * @param message - Message bytes to sign
 * @returns 64-byte Ed25519 signature
 * @throws If privateKey is not 32 bytes
 */
export function sign(privateKey, message) {
    if (!(privateKey instanceof Uint8Array) || privateKey.length !== 32) {
        throw new Error(`Invalid private key: expected 32 bytes, got ${privateKey?.length ?? 'null'}`);
    }
    if (!(message instanceof Uint8Array)) {
        throw new Error('Invalid message: expected Uint8Array');
    }
    return ed.sign(message, privateKey);
}
/**
 * Verify an Ed25519 signature.
 * @param publicKey - 32-byte Ed25519 public key
 * @param message - Original message bytes
 * @param signature - 64-byte Ed25519 signature
 * @returns true if signature is valid
 */
export function verify(publicKey, message, signature) {
    try {
        if (!(publicKey instanceof Uint8Array) || publicKey.length !== 32)
            return false;
        if (!(signature instanceof Uint8Array) || signature.length !== 64)
            return false;
        if (!(message instanceof Uint8Array))
            return false;
        return ed.verify(signature, message, publicKey);
    }
    catch {
        return false;
    }
}
/** BLAKE2b-256 hash */
export function blake2b256(data) {
    return blake2b(data, undefined, 32);
}
/** Canonical JSON (RFC 8785) */
export function canonicalize(obj) {
    const result = canonicalizeJson(obj);
    if (result === undefined) {
        throw new Error('Failed to canonicalize object');
    }
    return result;
}
/** Derive principal ID from a public key */
export function principalId(publicKey) {
    return toBase64url(publicKey);
}
/**
 * Sign a canonical JSON object: canonicalize → BLAKE2b → Ed25519 sign.
 * @param privateKey - 32-byte Ed25519 private key
 * @param obj - Object to sign (will be canonicalized)
 * @returns Base64url-encoded signature
 */
export function signObject(privateKey, obj) {
    const payload = new TextEncoder().encode(canonicalize(obj));
    const hash = blake2b256(payload);
    const sig = sign(privateKey, hash);
    return toBase64url(sig);
}
/**
 * Verify signature over a canonical JSON object.
 * @param publicKeyB64 - Base64url-encoded Ed25519 public key
 * @param obj - Object that was signed
 * @param signatureB64 - Base64url-encoded signature to verify
 * @returns true if signature is valid
 */
export function verifyObjectSignature(publicKeyB64, obj, signatureB64) {
    try {
        if (!publicKeyB64 || !signatureB64)
            return false;
        const publicKey = fromBase64url(publicKeyB64);
        const signature = fromBase64url(signatureB64);
        const payload = new TextEncoder().encode(canonicalize(obj));
        const hash = blake2b256(payload);
        return verify(publicKey, hash, signature);
    }
    catch {
        return false;
    }
}
