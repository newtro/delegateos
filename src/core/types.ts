/**
 * DelegateOS Core Types
 * Single source of truth for all shared types and interfaces.
 */

// ── Result Type ──

/** Discriminated union result type for error handling without exceptions */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

// ── Cryptographic Primitives ──

/** A principal identified by an Ed25519 public key */
export interface Principal {
  /** Base64url-encoded Ed25519 public key (32 bytes → 43 chars, no padding) */
  id: string;
  name?: string;
  metadata?: Record<string, string>;
}

/** Ed25519 keypair */
export interface Keypair {
  principal: Principal;
  privateKey: Uint8Array;
}

// ── Capability ──

/** A capability triple: namespace, action, resource */
export interface Capability {
  namespace: string;
  action: string;
  /** Glob pattern (supports * and **) */
  resource: string;
}

// ── Signed JSON Token (SJT) ──

export interface SignedJSONToken {
  format: 'delegateos-sjt-v1';
  authority: Authority;
  attenuations: Attenuation[];
  signatures: TokenSignature[];
}

export interface Authority {
  issuer: string;
  delegatee: string;
  capabilities: Capability[];
  contractId: string;
  delegationId: string;
  parentDelegationId: string;
  chainDepth: number;
  maxChainDepth: number;
  maxBudgetMicrocents: number;
  expiresAt: string;
  issuedAt: string;
}

export interface Attenuation {
  attenuator: string;
  delegatee: string;
  delegationId: string;
  contractId: string;
  allowedCapabilities?: Capability[];
  maxBudgetMicrocents?: number;
  expiresAt?: string;
  maxChainDepth?: number;
}

export interface TokenSignature {
  signer: string;
  /** Base64url Ed25519 signature */
  signature: string;
  /** What this signature covers */
  covers: 'authority' | number;
}

// ── Serialized DCT ──

/** Serialized token — opaque to callers */
export interface SerializedDCT {
  /** base64url of canonical JSON */
  token: string;
  format: 'delegateos-sjt-v1' | 'delegateos-biscuit-v1';
}

// ── DCT API Params ──

export interface DCTCreateParams {
  issuer: Keypair;
  delegatee: Principal;
  capabilities: Capability[];
  contractId: string;
  delegationId: string;
  parentDelegationId: string;
  chainDepth: number;
  maxChainDepth: number;
  maxBudgetMicrocents: number;
  expiresAt: string;
}

export interface DCTAttenuateParams {
  token: SerializedDCT;
  attenuator: Keypair;
  delegatee: Principal;
  delegationId: string;
  contractId: string;
  allowedCapabilities?: Capability[];
  maxBudgetMicrocents?: number;
  expiresAt?: string;
  maxChainDepth?: number;
}

// ── Verification Context ──

export interface VerificationContext {
  resource: string;
  namespace?: string;
  operation: string;
  now: string;
  spentMicrocents: number;
  rootPublicKey: string;
  revocationIds?: string[];
  maxChainDepth?: number;
}

export interface AuthorizedScope {
  capabilities: Capability[];
  remainingBudgetMicrocents: number;
  chainDepth: number;
  maxChainDepth: number;
  contractId: string;
  delegationId: string;
}

// ── Denial Reasons ──

export type DenialReason =
  | { type: 'expired' }
  | { type: 'revoked'; revocationId: string }
  | { type: 'capability_not_granted'; requested: Capability; granted: Capability[] }
  | { type: 'budget_exceeded'; limit: number; spent: number }
  | { type: 'chain_depth_exceeded'; max: number; actual: number }
  | { type: 'invalid_signature'; detail: string }
  | { type: 'attenuation_violation'; detail: string }
  | { type: 'malformed_token'; detail: string };

// ── Revocation ──

export interface RevocationEntry {
  revocationId: string;
  revokedBy: string;
  revokedAt: string;
  scope: 'block' | 'chain';
  signature: string;
}

// ── Verification / Check Functions ──

export interface CheckResult {
  passed: boolean;
  score?: number;
  details?: string;
}

export type CheckFunction = (output: unknown, params?: unknown) => CheckResult;

// ── Verification Spec ──

export interface VerificationSpec {
  method: 'schema_match' | 'deterministic_check' | 'composite';
  schema?: Record<string, unknown>;
  checkName?: string;
  checkParams?: unknown;
  expectedResult?: unknown;
  steps?: VerificationSpec[];
  mode?: 'all_pass' | 'majority' | 'weighted';
  weights?: number[];
  passThreshold?: number;
}

// ── Task Contract ──

export interface TaskSpec {
  title: string;
  description: string;
  inputs: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export interface TaskConstraints {
  maxBudgetMicrocents: number;
  deadline: string;
  maxChainDepth: number;
  requiredCapabilities: string[];
}

export interface TaskContract {
  id: string;
  version: '0.1';
  issuer: string;
  createdAt: string;
  task: TaskSpec;
  verification: VerificationSpec;
  constraints: TaskConstraints;
  signature: string;
}

// ── Attestation ──

export interface AttestationResult {
  success: boolean;
  output?: unknown;
  outputHash?: string;
  costMicrocents: number;
  durationMs: number;
  verificationOutcome?: {
    method: string;
    passed: boolean;
    score?: number;
    details?: string;
  };
}

export interface Attestation {
  id: string;
  version: '0.1';
  contractId: string;
  delegationId: string;
  principal: string;
  createdAt: string;
  type: 'completion' | 'delegation_verification';
  result: AttestationResult;
  childAttestations: string[];
  signature: string;
}

// ── Delegation Chain ──

export interface Delegation {
  id: string;
  parentId: string;
  from: string;
  to: string;
  contractId: string;
  dct: SerializedDCT;
  depth: number;
  status: 'active' | 'completed' | 'failed' | 'revoked';
  createdAt: string;
  completedAt?: string;
  attestationId?: string;
}
