/**
 * DelegateOS — Scoped delegation protocol for the agentic web.
 *
 * @packageDocumentation
 */
export type { Result, Principal, Keypair, Capability, SignedJSONToken, Authority, Attenuation, TokenSignature, SerializedDCT, DCTCreateParams, DCTAttenuateParams, VerificationContext, AuthorizedScope, DenialReason, RevocationEntry, CheckResult, CheckFunction, VerificationSpec, TaskSpec, TaskConstraints, TaskContract, AttestationResult, Attestation, Delegation, TrustOutcome, TrustProfile, TrustScore, TrustEngineConfig, SubTask, DecompositionPlan, DecompositionStrategy, DelegationFilter, StorageAdapter, } from './core/types.js';
export { generateKeypair, sign, verify, blake2b256, canonicalize, signObject, verifyObjectSignature, toBase64url, fromBase64url, principalId, } from './core/crypto.js';
export { createDCT, attenuateDCT, verifyDCT, inspectDCT, getRevocationIds, } from './core/dct.js';
export { MemoryChainStore, generateDelegationId, } from './core/chain.js';
export type { ChainStore } from './core/chain.js';
export { createCompletionAttestation, createDelegationVerificationAttestation, verifyAttestationSignature, } from './core/attestation.js';
export { InMemoryRevocationList, createRevocationEntry, cascadeRevoke, } from './core/revocation.js';
export type { RevocationListInterface } from './core/revocation.js';
export { createContract, verifyContractSignature, verifyOutput, createDefaultRegistry, CheckFunctionRegistry, } from './core/contract.js';
export { createMCPPlugin } from './mcp/plugin.js';
export type { MCPPlugin } from './mcp/plugin.js';
export { AuditLog } from './mcp/audit.js';
export type { AuditEntry, AuditDecision } from './mcp/audit.js';
export { InMemoryBudgetTracker } from './mcp/types.js';
export type { ToolCapabilityMap, BudgetTracker, MCPPluginConfig, DelegateOSMeta, MCPRequest, MCPErrorResponse, MCPResponse, } from './mcp/types.js';
export { TrustEngine } from './core/trust.js';
export { decompose, validatePlan, SequentialStrategy, ParallelStrategy, } from './core/decomposition.js';
export { DatalogEvaluator, DCTEngineFactory, createBiscuitDCT, attenuateBiscuitDCT, verifyBiscuitDCT, } from './core/biscuit.js';
export type { Fact, Rule, Check, Policy, DCTFormat, DCTEngine } from './core/biscuit.js';
export { VerificationEngine, MockLLMJudge, MockHumanReview, } from './core/verification.js';
export type { LLMJudgeSpec, HumanReviewSpec, LLMJudgeAdapter, HumanReviewAdapter, ExtendedVerificationSpec, SchemaMatchSpec, DeterministicCheckSpec, CompositeSpec, } from './core/verification.js';
export { AgentRegistry } from './a2a/registry.js';
export { DelegationBroker } from './a2a/broker.js';
export type { AgentCard, AgentFilter, DelegationPolicy } from './a2a/types.js';
export { LocalRevocationStore, DistributedRevocationStore, } from './core/distributed-revocation.js';
export type { RevocationStore, DistributedRevocationConfig, } from './core/distributed-revocation.js';
export { MemoryStorageAdapter } from './storage/memory.js';
export { SqliteStorageAdapter } from './storage/sqlite.js';
export type { TransportMessage, TransportResponse, TransportError, TransportConfig, SSEEvent, } from './transport/types.js';
export { MCPHttpServer } from './transport/http-server.js';
export { MCPHttpClient } from './transport/http-client.js';
export type { RetryConfig } from './transport/http-client.js';
export { SSEWriter, SSEReader } from './transport/sse.js';
export { createLogger, ConsoleLogger, setGlobalLogLevel, getGlobalLogLevel, setLogOutput, resetLogOutput, LogLevel } from './core/logger.js';
export type { Logger, LogEntry } from './core/logger.js';
export { RateLimiter, RateLimitMiddleware, ipKeyExtractor, principalKeyExtractor, combinedKeyExtractor } from './transport/rate-limiter.js';
export type { RateLimiterConfig, RateLimitResult, RouteLimitConfig, KeyExtractor } from './transport/rate-limiter.js';
export { MetricsCollector, globalMetrics } from './core/metrics.js';
export type { MetricsSnapshot, MetricsAdapter } from './core/metrics.js';
export { TOKEN_CURRENT_VERSION, isCompatible, migrateToken, registerMigration, clearMigrations, getTokenVersion, setTokenVersion, versionString, parseVersion, } from './core/token-version.js';
export type { TokenVersion, MigrateFn } from './core/token-version.js';
export { CircuitBreaker, CircuitOpenError } from './core/circuit-breaker.js';
export type { CircuitBreakerConfig, CircuitState, StateChangeCallback } from './core/circuit-breaker.js';
