/**
 * DelegateOS — Scoped delegation protocol for the agentic web.
 *
 * @packageDocumentation
 */
// ── Crypto ──
export { generateKeypair, sign, verify, blake2b256, canonicalize, signObject, verifyObjectSignature, toBase64url, fromBase64url, principalId, } from './core/crypto.js';
// ── DCT Engine ──
export { createDCT, attenuateDCT, verifyDCT, inspectDCT, getRevocationIds, } from './core/dct.js';
// ── Chain ──
export { MemoryChainStore, generateDelegationId, } from './core/chain.js';
// ── Attestation ──
export { createCompletionAttestation, createDelegationVerificationAttestation, verifyAttestationSignature, } from './core/attestation.js';
// ── Revocation ──
export { InMemoryRevocationList, createRevocationEntry, cascadeRevoke, } from './core/revocation.js';
// ── Contracts ──
export { createContract, verifyContractSignature, verifyOutput, createDefaultRegistry, CheckFunctionRegistry, } from './core/contract.js';
// ── MCP Plugin ──
export { createMCPPlugin } from './mcp/plugin.js';
export { AuditLog } from './mcp/audit.js';
export { InMemoryBudgetTracker } from './mcp/types.js';
// ── Trust Engine ──
export { TrustEngine } from './core/trust.js';
// ── Decomposition ──
export { decompose, validatePlan, SequentialStrategy, ParallelStrategy, } from './core/decomposition.js';
// ── Biscuit Engine ──
export { DatalogEvaluator, DCTEngineFactory, createBiscuitDCT, attenuateBiscuitDCT, verifyBiscuitDCT, } from './core/biscuit.js';
// ── Verification Engine ──
export { VerificationEngine, MockLLMJudge, MockHumanReview, } from './core/verification.js';
// ── A2A Protocol ──
export { AgentRegistry } from './a2a/registry.js';
export { DelegationBroker } from './a2a/broker.js';
// ── Distributed Revocation ──
export { LocalRevocationStore, DistributedRevocationStore, } from './core/distributed-revocation.js';
// ── Storage ──
export { MemoryStorageAdapter } from './storage/memory.js';
export { SqliteStorageAdapter } from './storage/sqlite.js';
export { MCPHttpServer } from './transport/http-server.js';
export { MCPHttpClient } from './transport/http-client.js';
export { SSEWriter, SSEReader } from './transport/sse.js';
// ── Logging ──
export { createLogger, ConsoleLogger, setGlobalLogLevel, getGlobalLogLevel, setLogOutput, resetLogOutput, LogLevel } from './core/logger.js';
// ── Rate Limiting ──
export { RateLimiter, RateLimitMiddleware, ipKeyExtractor, principalKeyExtractor, combinedKeyExtractor } from './transport/rate-limiter.js';
// ── Metrics ──
export { MetricsCollector, globalMetrics } from './core/metrics.js';
// ── Token Versioning ──
export { TOKEN_CURRENT_VERSION, isCompatible, migrateToken, registerMigration, clearMigrations, getTokenVersion, setTokenVersion, versionString, parseVersion, } from './core/token-version.js';
// ── Circuit Breaker ──
export { CircuitBreaker, CircuitOpenError } from './core/circuit-breaker.js';
