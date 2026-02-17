# DelegateOS

**Scoped delegation and accountability for the agentic web.**

DelegateOS is middleware that gives multi-agent systems what they're missing: cryptographic delegation tokens with monotonic attenuation, contract-based task verification, and transitive accountability chains. When Agent A delegates to Agent B who delegates to Agent C, DelegateOS ensures every link in that chain has scoped authority, verifiable completion, and a revocable trust boundary.

## Why

Every agent framework today — CrewAI, AutoGen, LangGraph, OpenClaw — assumes all agents are trusted and co-located. There's no way to say "this agent can search the web but not read my files" or "this delegation chain can spend at most $2." The [Google DeepMind delegation paper](https://arxiv.org/abs/2602.11865) (Feb 2026) explicitly calls out this gap: MCP handles tool access, A2A handles agent communication, but **nobody handles the trust and accountability layer between them**.

DelegateOS fills that gap.

## Key Concepts

- **[Delegation Capability Tokens (DCTs)](docs/architecture.md#2-token-strategy-dual-format)** — Ed25519-signed JSON tokens encoding scoped authority. Capabilities, budgets, expiry, chain depth — all enforced cryptographically.
- **[Monotonic Attenuation](docs/protocol-spec.md#34-token-attenuation)** — When you delegate downstream, you can only narrow scope, never expand it. A sub-agent gets ≤ your capabilities, ≤ your budget, ≤ your time.
- **[Contract-First Verification](docs/protocol-spec.md#5-task-contract)** — Every task has a contract specifying what "done" means: JSON Schema validation, deterministic checks, composite verification. No ambiguity.
- **[Attestation Chains](docs/protocol-spec.md#7-attestation)** — Cryptographic proof that work was completed and verified, forming an auditable chain from leaf agents back to the root delegator.
- **[Revocation](docs/protocol-spec.md#4-revocation)** — Revoke any delegation mid-flight. Single block or cascading — your call.

## Quick Start

```bash
npm install delegateos
```

```typescript
import { generateKeypair } from 'delegateos/core/crypto';
import { createDCT, attenuateDCT, verifyDCT } from 'delegateos/core/dct';

// 1. Create identities
const alice = generateKeypair();
const bob = generateKeypair();

// 2. Alice creates a root DCT for Bob
const dct = createDCT({
  issuer: alice,
  delegatee: bob.principal,
  capabilities: [
    { namespace: 'web', action: 'search', resource: '*' },
    { namespace: 'docs', action: 'read', resource: '/project/**' },
  ],
  contractId: 'ct_review_001',
  delegationId: 'del_001',
  parentDelegationId: 'del_000000000000',
  chainDepth: 0,
  maxChainDepth: 3,
  maxBudgetMicrocents: 500_000, // $5.00
  expiresAt: new Date(Date.now() + 3600_000).toISOString(), // 1 hour
});

// 3. Bob attenuates for a sub-agent (narrower scope)
const carol = generateKeypair();
const narrowDCT = attenuateDCT({
  token: dct,
  attenuator: bob,
  delegatee: carol.principal,
  delegationId: 'del_002',
  contractId: 'ct_review_001',
  allowedCapabilities: [
    { namespace: 'web', action: 'search', resource: 'arxiv.org/**' },
  ],
  maxBudgetMicrocents: 100_000, // $1.00
  maxChainDepth: 1,
});

// 4. Verify the token
const result = verifyDCT(narrowDCT, {
  resource: 'arxiv.org/abs/2602.11865',
  namespace: 'web',
  operation: 'search',
  now: new Date().toISOString(),
  spentMicrocents: 0,
  rootPublicKey: alice.principal.id,
  revocationIds: [],
});

if (result.ok) {
  console.log('Authorized:', result.value.capabilities);
  console.log('Budget remaining:', result.value.remainingBudgetMicrocents);
} else {
  console.log('Denied:', result.error.type);
}
```

See [Getting Started](docs/getting-started.md) for the full tutorial. See [API Reference](docs/api-reference.md) for all functions.

## MCP Integration

DelegateOS ships an MCP middleware plugin that intercepts `tools/call` requests and enforces DCT permissions transparently:

```typescript
import { createMCPPlugin } from 'delegateos/mcp/plugin';
import { InMemoryRevocationList } from 'delegateos/core/revocation';

const plugin = createMCPPlugin({
  toolCapabilities: {
    web_search: { namespace: 'web', action: 'search' },
    read_file: { namespace: 'docs', action: 'read',
      resourceExtractor: (args) => args.path as string },
  },
  trustedRoots: [orchestratorPublicKey],
  revocations: new InMemoryRevocationList(),
  budgetTracker: { getSpent: () => 0, recordSpend: () => {} },
});

// Intercept incoming MCP request
const result = await plugin.handleRequest(mcpRequest);
```

The plugin filters `tools/list` to only show tools the DCT grants access to, strips `_delegateos` metadata before forwarding upstream, and tracks spend per delegation.

See [API Reference — MCP Plugin](docs/api-reference.md#mcpplugin) for full details.

## Demo

Run the PR review delegation demo — an orchestrator delegates code review to 3 specialists (security, Blazor, database), each with attenuated tokens:

```bash
npx tsx src/demo/scenario.ts
```

Demonstrates: delegation chains, attestation signing, token attenuation enforcement, mid-flow revocation, and expired token rejection.

## Use Cases

### Use Case 1: Personal AI Assistant with Tool Guardrails

**Scenario:** You're building a personal AI assistant that can search the web, read your documents, and send emails. You want it to delegate research tasks to a cheaper, faster model — but that sub-agent should never be able to send emails or read your private files.

**Actors:** You (the user), your main assistant (GPT-4 class), a research sub-agent (smaller model)

```typescript
import {
  generateKeypair, createDCT, attenuateDCT, verifyDCT,
  createMCPPlugin, InMemoryRevocationList
} from 'delegateos';

// Your assistant and its sub-agent each get an identity
const assistant = generateKeypair();
const researcher = generateKeypair();

// You (the root authority) grant your assistant broad capabilities
const you = generateKeypair();
const assistantToken = createDCT({
  issuer: you,
  delegatee: assistant.principal,
  capabilities: [
    { namespace: 'web', action: 'search', resource: '*' },
    { namespace: 'docs', action: 'read', resource: '/home/me/**' },
    { namespace: 'email', action: 'send', resource: '*' },
  ],
  contractId: 'ct_daily_tasks',
  delegationId: 'del_001',
  parentDelegationId: 'root',
  chainDepth: 0,
  maxChainDepth: 2,
  maxBudgetMicrocents: 1_000_000, // $10
  expiresAt: new Date(Date.now() + 86400_000).toISOString(), // 24 hours
});

// Your assistant delegates research to a sub-agent — but ONLY web search
// The sub-agent physically cannot access docs or email, even if it tries
const researchToken = attenuateDCT({
  token: assistantToken,
  attenuator: assistant,
  delegatee: researcher.principal,
  delegationId: 'del_002',
  contractId: 'ct_daily_tasks',
  allowedCapabilities: [
    { namespace: 'web', action: 'search', resource: '*.edu/**' }, // only .edu sites
  ],
  maxBudgetMicrocents: 50_000, // $0.50 — tight budget
  expiresAt: new Date(Date.now() + 600_000).toISOString(), // 10 minutes
});

// When the research agent tries to call a tool, DelegateOS checks the token
const check = verifyDCT(researchToken, {
  resource: 'arxiv.org/search',
  namespace: 'web',
  operation: 'search',
  now: new Date().toISOString(),
  spentMicrocents: 0,
  rootPublicKey: you.principal.id,
});
// ✅ Allowed — arxiv.org matches *.edu/** pattern

const emailCheck = verifyDCT(researchToken, {
  resource: 'boss@company.com',
  namespace: 'email',
  operation: 'send',
  now: new Date().toISOString(),
  spentMicrocents: 0,
  rootPublicKey: you.principal.id,
});
// ❌ Denied — email capability was never delegated
```

**What you get:** Your sub-agent can search the web within its scope. It can't read your files, send emails, overspend its budget, or outlive its 10-minute window. No trust required — it's enforced cryptographically.

---

### Use Case 2: Dev Team Code Review Pipeline

**Scenario:** You're a tech lead building an automated PR review system. You want an orchestrator agent to farm out reviews to specialist agents (security, performance, style), each with access to only the repos and tools they need. When a specialist finishes, you want cryptographic proof of what they reviewed.

**Actors:** CI/CD system (root), orchestrator agent, 3 specialist agents

```typescript
import {
  generateKeypair, createDCT, attenuateDCT,
  createContract, signContract, createAttestation, signAttestation,
  DelegationChainStore, TrustEngine,
} from 'delegateos';

// Identities
const ciSystem = generateKeypair();
const orchestrator = generateKeypair();
const securityAgent = generateKeypair();
const perfAgent = generateKeypair();
const styleAgent = generateKeypair();

// CI system creates a root token for the orchestrator
const rootToken = createDCT({
  issuer: ciSystem,
  delegatee: orchestrator.principal,
  capabilities: [
    { namespace: 'git', action: 'read', resource: 'myorg/myrepo/**' },
    { namespace: 'git', action: 'comment', resource: 'myorg/myrepo/pulls/*' },
    { namespace: 'analysis', action: 'run', resource: '*' },
  ],
  contractId: 'ct_pr_review_789',
  delegationId: 'del_root',
  parentDelegationId: 'root',
  chainDepth: 0,
  maxChainDepth: 2,
  maxBudgetMicrocents: 2_000_000, // $20 total for all reviews
  expiresAt: new Date(Date.now() + 1800_000).toISOString(), // 30 minutes
});

// Orchestrator creates a contract for the security review
const securityContract = createContract({
  issuer: orchestrator.principal.id,
  task: {
    title: 'Security Review — PR #789',
    description: 'Review for SQL injection, XSS, auth bypass, secrets in code',
    inputs: { prNumber: 789, repo: 'myorg/myrepo', diffUrl: '...' },
    outputSchema: {
      type: 'object',
      required: ['vulnerabilities', 'severity', 'recommendation'],
      properties: {
        vulnerabilities: { type: 'array' },
        severity: { enum: ['none', 'low', 'medium', 'high', 'critical'] },
        recommendation: { enum: ['approve', 'request_changes', 'block'] },
      },
    },
  },
  verification: { method: 'schema_match' },
  constraints: {
    maxBudgetMicrocents: 500_000,
    deadline: new Date(Date.now() + 600_000).toISOString(),
    maxChainDepth: 1,
    requiredCapabilities: ['git:read'],
  },
}, orchestrator);

// Attenuated token for the security agent — read-only, no commenting
const securityToken = attenuateDCT({
  token: rootToken,
  attenuator: orchestrator,
  delegatee: securityAgent.principal,
  delegationId: 'del_security',
  contractId: securityContract.id,
  allowedCapabilities: [
    { namespace: 'git', action: 'read', resource: 'myorg/myrepo/**' },
    { namespace: 'analysis', action: 'run', resource: 'security/*' },
  ],
  maxBudgetMicrocents: 500_000,
});

// ... (similar for perfAgent, styleAgent with their own scoped tokens)

// When security agent finishes, it creates a signed attestation
const attestation = createAttestation({
  contractId: securityContract.id,
  delegationId: 'del_security',
  principal: securityAgent.principal.id,
  type: 'completion',
  result: {
    success: true,
    output: {
      vulnerabilities: [{ type: 'XSS', file: 'src/input.ts', line: 42 }],
      severity: 'medium',
      recommendation: 'request_changes',
    },
    costMicrocents: 150_000,
    durationMs: 45_000,
    verificationOutcome: { method: 'schema_match', passed: true },
  },
}, securityAgent);

// Orchestrator can verify: the attestation is signed, output matches schema,
// and the agent had a valid token when it produced the result.
// The trust engine records the outcome for future delegation decisions.
const trust = new TrustEngine();
trust.recordOutcome(securityAgent.principal.id, attestation);
console.log(trust.getScore(securityAgent.principal.id));
// → { composite: 0.85, reliability: 1.0, quality: 0.7, speed: 0.9 }
```

**What you get:** Each specialist can only access what it needs. The orchestrator can't exceed the CI system's budget. Every review produces a signed, verifiable attestation. Trust scores improve over time, so reliable agents get delegated first.

---

### Use Case 3: Multi-Tenant Agent Marketplace

**Scenario:** You're building a platform where businesses can publish AI agents as services (data analysis, legal research, translation). When a customer submits a job, your platform needs to: discover capable agents, negotiate delegation terms, split complex jobs into sub-tasks, route them to specialists, track spending, and provide verifiable proof of completion — all while ensuring no agent can access another customer's data.

**Actors:** Platform (root authority), customer, orchestrator, 3+ marketplace agents from different vendors

```typescript
import {
  generateKeypair, createDCT, attenuateDCT,
  createContract, signContract,
  AgentRegistry, DelegationBroker, TrustEngine,
  DelegationChainStore, DecompositionEngine, SequentialStrategy,
  VerificationEngine, MockLLMJudge,
  MemoryStorageAdapter,
} from 'delegateos';

// === Setup: Platform registers available agents ===

const platform = generateKeypair();
const registry = new AgentRegistry();
const trust = new TrustEngine();
const storage = new MemoryStorageAdapter();

// Vendor agents register their Agent Cards
const dataAnalyst = generateKeypair();
registry.register({
  id: 'agent_data_analyst',
  name: 'DataCrunch Pro',
  description: 'Statistical analysis, visualization, ML model evaluation',
  principal: dataAnalyst.principal.id,
  capabilities: [
    { namespace: 'data', action: 'analyze', resource: '*' },
    { namespace: 'data', action: 'visualize', resource: '*' },
  ],
  delegationPolicy: {
    acceptsDelegation: true,
    maxChainDepth: 2,
    requiredTrustScore: 0.3,
    allowedNamespaces: ['data'],
    costPerTaskMicrocents: 200_000, // $2.00 per task
  },
  signature: '...', // self-signed with dataAnalyst's key
  metadata: { vendor: 'DataCrunch Inc', sla: '99.9%' },
});

// ... register translator, legal researcher, etc.

// === Customer submits a complex job ===

const customer = generateKeypair();

// Platform creates the master contract
const masterContract = createContract({
  issuer: platform.principal.id,
  task: {
    title: 'Q4 Market Analysis Report',
    description: 'Analyze Q4 sales data, translate executive summary to 3 languages, check for regulatory compliance',
    inputs: {
      dataset: 'customer_12345/q4_sales.csv', // customer-scoped!
      languages: ['es', 'de', 'ja'],
      regulations: ['GDPR', 'CCPA'],
    },
    outputSchema: {
      type: 'object',
      required: ['analysis', 'translations', 'compliance'],
    },
  },
  verification: {
    method: 'composite',
    steps: [
      { method: 'schema_match' },
      { method: 'llm_judge', prompt: 'Rate the analysis quality', criteria: ['accuracy', 'depth', 'actionability'], passingScore: 0.7 },
    ],
    mode: 'all_pass',
  },
  constraints: {
    maxBudgetMicrocents: 5_000_000, // $50 total
    deadline: new Date(Date.now() + 7200_000).toISOString(), // 2 hours
    maxChainDepth: 3,
    requiredCapabilities: ['data:analyze', 'translate:text', 'legal:review'],
  },
}, platform);

// === Decompose into sub-tasks ===

const decomposition = new DecompositionEngine();
const plan = decomposition.decompose(masterContract, new SequentialStrategy());
// → Sub-task 1: Data analysis ($20 budget, 45min)
// → Sub-task 2: Translation ($15 budget, 30min, depends on #1)
// → Sub-task 3: Compliance review ($15 budget, 30min, depends on #1)

// === Broker discovers and delegates to best agents ===

const broker = new DelegationBroker(registry, trust);
const chain = new DelegationChainStore();

for (const subtask of plan.subtasks) {
  // Find the best agent — considers capabilities, trust score, cost
  const agent = broker.findAgent(subtask.contract, chain);

  if (agent.ok) {
    // Create a scoped DCT — this agent can ONLY access this customer's data
    const delegation = broker.proposeDelegation(
      platform,
      agent.value,
      subtask.contract,
    );

    // The DCT ensures:
    // - Data analyst can read customer_12345/* but NOT customer_67890/*
    // - Translator gets the analysis output but NOT the raw dataset
    // - No agent can exceed its budget fraction
    // - Everything expires when the master deadline hits
    // - Any delegation can be revoked mid-flight if something goes wrong

    await storage.saveDelegation(delegation.value.delegation);
  }
}

// === Verify results with composite verification ===

const verifier = new VerificationEngine();
verifier.registerLLMJudge(new MockLLMJudge({ defaultScore: 0.85 }));

const analysisOutput = { /* ... agent's output ... */ };
const verification = await verifier.verify(analysisOutput, masterContract.verification);
// → { passed: true, score: 0.85, details: 'Schema valid. LLM judge: 0.85 (accuracy: 0.9, depth: 0.8, actionability: 0.85)' }

// Trust scores update based on outcomes — reliable agents rise to the top
trust.recordOutcome(dataAnalyst.principal.id, attestation);
```

**What you get:** Complete tenant isolation enforced cryptographically — not just by access control lists. Automatic agent discovery and delegation. Complex jobs decomposed and routed to specialists. Budget tracking across the entire chain. Composite verification (schema + LLM judge). Trust scores that improve over time so the best agents get more work. Every step produces a signed attestation for auditing.

---

### Choosing DelegateOS for Your Architecture

| You need... | Without DelegateOS | With DelegateOS |
|---|---|---|
| Sub-agent can only use certain tools | Honor system / prompt engineering | Cryptographically enforced capabilities |
| Spending cap across a delegation chain | Manual tracking, easy to exceed | Budget enforced at every verification |
| Proof that work was completed correctly | Trust the agent's word | Signed attestation with schema validation |
| Revoke a misbehaving agent mid-task | Kill the process and hope | Revoke the DCT — all downstream instantly invalid |
| Find the best agent for a job | Hardcoded routing | Agent registry + trust scores + capability matching |
| Split complex jobs across specialists | Manual orchestration | Contract decomposition with budget/deadline propagation |
| Audit trail of who did what | Scattered logs | Cryptographic attestation chain from root to leaf |

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full architecture document, including token format, verification algorithms, security model, and package structure.

See [docs/protocol-spec.md](docs/protocol-spec.md) for the wire-level protocol specification.

## Features

### Core (v0.1)
- **DCT Engine** — Create, attenuate, verify Ed25519-signed JSON tokens
- **Contract System** — Task contracts with schema, deterministic, and composite verification
- **Attestation Engine** — Signed completion and delegation verification attestations
- **Revocation** — In-memory revocation list with cascade support
- **Delegation Chain Store** — In-memory chain tracking with integrity verification
- **MCP Middleware** — `tools/call` interception, DCT enforcement, audit logging
- **Demo** — Full PR review delegation scenario

### v0.2 Phase A
- **Trust/Reputation Engine** — Composite trust scoring with exponential decay, cold-start handling, reliability/quality/speed breakdown
- **Contract Decomposition** — Recursive task splitting with sequential and parallel strategies, dependency tracking, budget/deadline/capability validation
- **Biscuit Token Backend** — Pure TypeScript Datalog engine with forward-chaining evaluation, Biscuit-compatible token format as opt-in upgrade from SJT
- **Persistent Storage** — Abstract `StorageAdapter` interface with in-memory and SQLite (`better-sqlite3`) implementations

### v0.2 Phase B
- **Verification Engine** — Unified `VerificationEngine` class dispatching across all 5 verification methods: `schema_match`, `deterministic_check`, `composite`, `llm_judge`, `human_review`. Pluggable `LLMJudgeAdapter` and `HumanReviewAdapter` interfaces with mock implementations for testing
- **A2A Protocol** — Agent Card self-describing identity with Ed25519-signed cards, `AgentRegistry` for discovery/resolution, `DelegationBroker` for automated agent selection and delegation proposal based on capabilities, trust scores, and cost
- **Distributed Revocation** — Async `RevocationStore` interface with `LocalRevocationStore` (wraps existing) and `DistributedRevocationStore` with gossip-style sync, anti-entropy, deduplication, and signature verification. In-process simulation for v0.2

### v0.2 Phase C
- **HTTP+SSE Transport** — `MCPHttpServer` exposing MCP middleware over HTTP with SSE streaming, `MCPHttpClient` with retry/backoff, `SSEWriter`/`SSEReader` utilities. Routes: `/mcp/message`, `/mcp/stream`, `/mcp/events/:sessionId`, `/health`, `/agents`
- **Integration Tests** — 48 end-to-end tests covering full delegation lifecycle (3-level chains, budget cascade, capability attenuation, mid-chain revocation), HTTP transport, trust+verification, and storage roundtrips across both adapters

**v0.2 complete** — 257 tests, 0 TypeScript errors.

### v0.3 — Production Readiness
- **Structured Logging** — `Logger` interface with `ConsoleLogger` outputting JSON-structured logs (timestamp, level, module, message, context). `createLogger(module)` factory, `LogLevel` enum (DEBUG/INFO/WARN/ERROR/SILENT), runtime `setGlobalLogLevel()`, per-logger level override
- **Rate Limiting** — Token bucket `RateLimiter` with per-key tracking, `RateLimitMiddleware` with route-based configs, wildcard pattern matching, configurable key extraction (IP/principal/combined), automatic stale bucket cleanup, 429 with Retry-After
- **Metrics & Observability** — `MetricsCollector` with counter/gauge/histogram primitives, tag-based dimensionality, `MetricsAdapter` interface for external systems (Prometheus, StatsD), snapshot export, `globalMetrics` singleton
- **Token Versioning & Migration** — `TokenVersion` type, backward-compatible version field (missing = v1.0), `isCompatible()` check, `migrateToken()` with registered migration functions, migration registry with `registerMigration()`
- **Circuit Breaker** — `CircuitBreaker` with CLOSED/OPEN/HALF_OPEN states, configurable failure threshold and reset timeout, state change callbacks, `CircuitOpenError`, `forceReset()` for manual recovery
- **Rate Limit Infrastructure** — Route-level rate limiting with exact and prefix matching, separate buckets per key, periodic cleanup of stale entries

**v0.3 complete** — 374 tests across 27 files, 0 TypeScript errors.

## License

MIT
