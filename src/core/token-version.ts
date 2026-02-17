/**
 * Token Versioning & Migration — Forward compatibility for token format changes.
 */

import type { SerializedDCT, Result } from './types.js';
import { fromBase64url, toBase64url } from './crypto.js';

// ── Types ──

export interface TokenVersion {
  major: number;
  minor: number;
}

export type MigrateFn = (token: SerializedDCT) => Result<SerializedDCT>;

export const TOKEN_CURRENT_VERSION: TokenVersion = { major: 1, minor: 0 };

// ── Version Helpers ──

export function versionString(v: TokenVersion): string {
  return `${v.major}.${v.minor}`;
}

export function parseVersion(s: string): TokenVersion | null {
  const parts = s.split('.');
  if (parts.length !== 2) return null;
  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);
  if (isNaN(major) || isNaN(minor)) return null;
  return { major, minor };
}

/**
 * Check if a token version is compatible with the engine version.
 * Compatible if same major version and token minor <= engine minor.
 */
export function isCompatible(tokenVersion: TokenVersion, engineVersion: TokenVersion): boolean {
  return tokenVersion.major === engineVersion.major && tokenVersion.minor <= engineVersion.minor;
}

// ── Migration Registry ──

interface MigrationEntry {
  from: TokenVersion;
  to: TokenVersion;
  fn: MigrateFn;
}

const migrations: MigrationEntry[] = [];

/** Register a migration function between two versions. */
export function registerMigration(from: TokenVersion, to: TokenVersion, fn: MigrateFn): void {
  migrations.push({ from, to, fn });
}

/** Clear all registered migrations (for testing). */
export function clearMigrations(): void {
  migrations.length = 0;
}

/** Get the version embedded in a token, or v1.0 if missing. */
export function getTokenVersion(token: SerializedDCT): TokenVersion {
  try {
    const json = JSON.parse(new TextDecoder().decode(fromBase64url(token.token)));
    if (json.version) {
      const parsed = parseVersion(json.version);
      if (parsed) return parsed;
    }
  } catch {
    // Fall through to default
  }
  return { major: 1, minor: 0 };
}

/** Set the version field on a token. */
export function setTokenVersion(token: SerializedDCT, version: TokenVersion): Result<SerializedDCT> {
  try {
    const json = JSON.parse(new TextDecoder().decode(fromBase64url(token.token)));
    json.version = versionString(version);
    const encoded = toBase64url(new TextEncoder().encode(JSON.stringify(json)));
    return { ok: true, value: { token: encoded, format: token.format } };
  } catch (e) {
    return { ok: false, error: new Error(`Failed to set version: ${e}`) };
  }
}

/**
 * Migrate a token from one version to another using registered migrations.
 * Finds a path from `from` to `to` and applies migrations in sequence.
 */
export function migrateToken(
  token: SerializedDCT,
  fromVersion: TokenVersion,
  toVersion: TokenVersion,
): Result<SerializedDCT> {
  if (fromVersion.major === toVersion.major && fromVersion.minor === toVersion.minor) {
    return { ok: true, value: token };
  }

  // Find migration path (simple: step through minor versions)
  let current = { ...fromVersion };
  let currentToken = token;

  while (current.major !== toVersion.major || current.minor !== toVersion.minor) {
    const migration = migrations.find(
      m => m.from.major === current.major && m.from.minor === current.minor
        && m.to.major === toVersion.major && (m.to.minor <= toVersion.minor),
    );

    if (!migration) {
      return { ok: false, error: new Error(`No migration path from ${versionString(current)} to ${versionString(toVersion)}`) };
    }

    const result = migration.fn(currentToken);
    if (!result.ok) return result;

    currentToken = result.value;
    current = { ...migration.to };
  }

  return { ok: true, value: currentToken };
}
