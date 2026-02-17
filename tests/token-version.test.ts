import { describe, it, expect, beforeEach } from 'vitest';
import {
  TOKEN_CURRENT_VERSION,
  isCompatible,
  migrateToken,
  registerMigration,
  clearMigrations,
  getTokenVersion,
  setTokenVersion,
  versionString,
  parseVersion,
} from '../src/core/token-version.js';
import type { SerializedDCT } from '../src/core/types.js';
import { toBase64url } from '../src/core/crypto.js';

function makeToken(obj: Record<string, unknown>): SerializedDCT {
  return {
    token: toBase64url(new TextEncoder().encode(JSON.stringify(obj))),
    format: 'delegateos-sjt-v1',
  };
}

describe('Token Versioning', () => {
  beforeEach(() => {
    clearMigrations();
  });

  it('TOKEN_CURRENT_VERSION is 1.0', () => {
    expect(TOKEN_CURRENT_VERSION).toEqual({ major: 1, minor: 0 });
  });

  it('versionString formats correctly', () => {
    expect(versionString({ major: 1, minor: 0 })).toBe('1.0');
    expect(versionString({ major: 2, minor: 3 })).toBe('2.3');
  });

  it('parseVersion parses correctly', () => {
    expect(parseVersion('1.0')).toEqual({ major: 1, minor: 0 });
    expect(parseVersion('2.3')).toEqual({ major: 2, minor: 3 });
  });

  it('parseVersion returns null for invalid', () => {
    expect(parseVersion('abc')).toBeNull();
    expect(parseVersion('1.2.3')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });

  describe('isCompatible', () => {
    it('same version is compatible', () => {
      expect(isCompatible({ major: 1, minor: 0 }, { major: 1, minor: 0 })).toBe(true);
    });

    it('older minor is compatible', () => {
      expect(isCompatible({ major: 1, minor: 0 }, { major: 1, minor: 1 })).toBe(true);
    });

    it('newer minor is not compatible', () => {
      expect(isCompatible({ major: 1, minor: 2 }, { major: 1, minor: 1 })).toBe(false);
    });

    it('different major is not compatible', () => {
      expect(isCompatible({ major: 2, minor: 0 }, { major: 1, minor: 5 })).toBe(false);
    });
  });

  describe('getTokenVersion', () => {
    it('returns version from token', () => {
      const token = makeToken({ version: '1.1', data: 'test' });
      expect(getTokenVersion(token)).toEqual({ major: 1, minor: 1 });
    });

    it('returns 1.0 for missing version', () => {
      const token = makeToken({ data: 'test' });
      expect(getTokenVersion(token)).toEqual({ major: 1, minor: 0 });
    });
  });

  describe('setTokenVersion', () => {
    it('sets version on token', () => {
      const token = makeToken({ data: 'test' });
      const result = setTokenVersion(token, { major: 1, minor: 1 });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(getTokenVersion(result.value)).toEqual({ major: 1, minor: 1 });
      }
    });
  });

  describe('migrateToken', () => {
    it('no-op migration for same version', () => {
      const token = makeToken({ data: 'test' });
      const result = migrateToken(token, { major: 1, minor: 0 }, { major: 1, minor: 0 });
      expect(result.ok).toBe(true);
    });

    it('applies registered migration', () => {
      registerMigration(
        { major: 1, minor: 0 },
        { major: 1, minor: 1 },
        (t) => {
          // Add a 'migrated' field
          const json = JSON.parse(new TextDecoder().decode(
            Uint8Array.from(atob(t.token.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
          ));
          json.migrated = true;
          json.version = '1.1';
          const encoded = toBase64url(new TextEncoder().encode(JSON.stringify(json)));
          return { ok: true as const, value: { token: encoded, format: t.format } };
        },
      );

      const token = makeToken({ data: 'original' });
      const result = migrateToken(token, { major: 1, minor: 0 }, { major: 1, minor: 1 });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(getTokenVersion(result.value)).toEqual({ major: 1, minor: 1 });
      }
    });

    it('returns error when no migration path exists', () => {
      const token = makeToken({ data: 'test' });
      const result = migrateToken(token, { major: 1, minor: 0 }, { major: 1, minor: 5 });
      expect(result.ok).toBe(false);
    });

    it('propagates migration function errors', () => {
      registerMigration(
        { major: 1, minor: 0 },
        { major: 1, minor: 1 },
        () => ({ ok: false, error: new Error('Migration failed') }),
      );

      const token = makeToken({ data: 'test' });
      const result = migrateToken(token, { major: 1, minor: 0 }, { major: 1, minor: 1 });
      expect(result.ok).toBe(false);
    });
  });
});
