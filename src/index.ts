/**
 * DelegateOS — Scoped delegation protocol for the agentic web.
 *
 * @packageDocumentation
 */

// ── Core Types ──
export type {
  Result,
  Principal,
  Keypair,
  Capability,
  SignedJSONToken,
  Authority,
  Attenuation,
  TokenSignature,
  SerializedDCT,
  DCTCreateParams,
  DCTAttenuateParams,
  VerificationContext,
  AuthorizedScope,
  DenialReason,
  RevocationEntry,
  CheckResult,
  CheckFunction,
  VerificationSpec,
  TaskSpec,
  TaskConstraints,
  TaskContract,
  AttestationResult,
  Attestation,
  Delegation,
  TrustOutcome,
  TrustProfile,
  TrustScore,
  TrustEngineConfig,
  SubTask,
  DecompositionPlan,
  DecompositionStrategy,
  DelegationFilter,
  StorageAdapter,
} from './core/types.js';

// ── Crypto ──
export {
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
} from './core/crypto.js';

// ── DCT Engine ──
export {
  createDCT,
  attenuateDCT,
  verifyDCT,
  inspectDCT,
  getRevocationIds,
} from './core/dct.js';

// ── Chain ──
export {
  MemoryChainStore,
  generateDelegationId,
} from './core/chain.js';
export type { ChainStore } from './core/chain.js';

// ── Attestation ──
export {
  createCompletionAttestation,
  createDelegationVerificationAttestation,
  verifyAttestationSignature,
} from './core/attestation.js';

// ── Revocation ──
export {
  InMemoryRevocationList,
  createRevocationEntry,
  cascadeRevoke,
} from './core/revocation.js';
export type { RevocationListInterface } from './core/revocation.js';

// ── Contracts ──
export {
  createContract,
  verifyContractSignature,
  verifyOutput,
  createDefaultRegistry,
  CheckFunctionRegistry,
} from './core/contract.js';

// ── MCP Plugin ──
export { createMCPPlugin } from './mcp/plugin.js';
export type { MCPPlugin } from './mcp/plugin.js';
export { AuditLog } from './mcp/audit.js';
export type { AuditEntry, AuditDecision } from './mcp/audit.js';
export { InMemoryBudgetTracker } from './mcp/types.js';
export type {
  ToolCapabilityMap,
  BudgetTracker,
  MCPPluginConfig,
  DelegateOSMeta,
  MCPRequest,
  MCPErrorResponse,
  MCPResponse,
} from './mcp/types.js';

// ── Trust Engine ──
export { TrustEngine } from './core/trust.js';

// ── Decomposition ──
export {
  decompose,
  validatePlan,
  SequentialStrategy,
  ParallelStrategy,
} from './core/decomposition.js';

// ── Biscuit Engine ──
export {
  DatalogEvaluator,
  DCTEngineFactory,
  createBiscuitDCT,
  attenuateBiscuitDCT,
  verifyBiscuitDCT,
} from './core/biscuit.js';
export type { Fact, Rule, Check, Policy, DCTFormat } from './core/biscuit.js';

// ── Verification Engine ──
export {
  VerificationEngine,
  MockLLMJudge,
  MockHumanReview,
} from './core/verification.js';
export type {
  LLMJudgeSpec,
  HumanReviewSpec,
  LLMJudgeAdapter,
  HumanReviewAdapter,
  ExtendedVerificationSpec,
  SchemaMatchSpec,
  DeterministicCheckSpec,
  CompositeSpec,
} from './core/verification.js';

// ── A2A Protocol ──
export { AgentRegistry } from './a2a/registry.js';
export { DelegationBroker } from './a2a/broker.js';
export type { AgentCard, AgentFilter, DelegationPolicy } from './a2a/types.js';

// ── Distributed Revocation ──
export {
  LocalRevocationStore,
  DistributedRevocationStore,
} from './core/distributed-revocation.js';
export type {
  RevocationStore,
  DistributedRevocationConfig,
} from './core/distributed-revocation.js';

// ── Storage ──
export { MemoryStorageAdapter } from './storage/memory.js';
export { SqliteStorageAdapter } from './storage/sqlite.js';
