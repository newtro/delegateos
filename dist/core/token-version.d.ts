/**
 * Token Versioning & Migration — Forward compatibility for token format changes.
 */
import type { SerializedDCT, Result } from './types.js';
export interface TokenVersion {
    major: number;
    minor: number;
}
export type MigrateFn = (token: SerializedDCT) => Result<SerializedDCT>;
export declare const TOKEN_CURRENT_VERSION: TokenVersion;
export declare function versionString(v: TokenVersion): string;
export declare function parseVersion(s: string): TokenVersion | null;
/**
 * Check if a token version is compatible with the engine version.
 * Compatible if same major version and token minor <= engine minor.
 */
export declare function isCompatible(tokenVersion: TokenVersion, engineVersion: TokenVersion): boolean;
/** Register a migration function between two versions. */
export declare function registerMigration(from: TokenVersion, to: TokenVersion, fn: MigrateFn): void;
/** Clear all registered migrations (for testing). */
export declare function clearMigrations(): void;
/** Get the version embedded in a token, or v1.0 if missing. */
export declare function getTokenVersion(token: SerializedDCT): TokenVersion;
/** Set the version field on a token. */
export declare function setTokenVersion(token: SerializedDCT, version: TokenVersion): Result<SerializedDCT>;
/**
 * Migrate a token from one version to another using registered migrations.
 * Finds a path from `from` to `to` and applies migrations in sequence.
 */
export declare function migrateToken(token: SerializedDCT, fromVersion: TokenVersion, toVersion: TokenVersion): Result<SerializedDCT>;
