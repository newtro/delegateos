# DelegateOS Architecture Document

**Version:** 0.2 (revised)  
**Date:** 2026-02-17  
**Status:** Draft — Post-review iteration

---

## 0. Scope Decision

### v0.1 — Ship This
- **DCT Engine:** Token creation, attenuation, verification with Ed25519 signed JSON tokens (fallback format) + optional Biscuit upgrade path
- **MCP Middleware Plugin:** Intercept `tools/call`, enforce DCT permissions
- **Attestation Signing:** Create and verify completion attestations
- **Revocation:** In-process revocation list checked at verification time
- **Demo Scenario:** Orchestrator → Specialist delegation with MCP tool enforcement

### v0.2 — Deferred
- Trust/reputation scoring engine
- A2A protocol integration
- Contract decomposition engine (recursive task splitting)
- Agent payments / AP2 integration
- Persistent storage (SQLite/Postgres)
- Biscuit WASM token backend (upgrade from signed JSON)

---

## 1. Executive Summary

DelegateOS is middleware that adds scoped delegation and accountability to the agentic web. For v0.1, it provides:

- **Delegation Capability Tokens (DCTs):** Ed25519-signed JSON tokens encoding scoped authority with monotonic attenuation
- **MCP middleware:** Transparent proxy that intercepts `tools/call` and enforces DCT permissions
- **Attestation signing:** Cryptographic proof of task completion

### Architecture Position (v0.1)

```
┌──────────────────────────────────────────┐
│           Agent Frameworks               │
│    OpenClaw  │  CrewAI  │  AutoGen       │
└──────┬───────────────────────┬───────────┘
       │                       │
 ┌─────▼───────────────────────▼─────┐
 │        DelegateOS Middleware       │
 │  ┌──────────┐  ┌───────────────┐  │
 │  │DCT Engine│  │  Attestation  │  │
 │  └──────────┘  └───────────────┘  │
 │  ┌──────────┐  ┌───────────────┐  │
 │  │Revocation│  │  MCP Plugin   │  │
 │  │  List    │  │               │  │
 │  └──────────┘  └───────────────┘  │
 └──────┬───────────────────────┬────┘
        │                       │
 ┌──────▼───────────────────────▼────┐
 │         MCP Servers               │
 └───────────────────────────────────┘
```

---

## 2. Token Strategy: Dual Format

### 2.1 Why Two Formats

The reviewer identified `@biscuit-auth/biscuit-wasm` as a critical risk. The WASM bindings for Biscuit are Rust-first, experimental in Node.js, and could block development on day 1.

**Strategy:** Build v0.1 on **Ed25519 signed JSON tokens** (using `@noble/ed25519`). Design the `DCTEngine` interface so Biscuit can be swapped in as a backend in v0.2 without changing any calling code.

### 2.2 Signed JSON Token Format (v0.1 — Primary)

A DCT is a JSON object with an Ed25519 signature. Attenuation works by minting a **new, narrower token** signed by the attenuator, with a `proof` chain linking back to the parent.

```typescript
interface SignedJSONToken {
  /** Token format identifier */
  format: 'delegateos-sjt-v1';

  /** Authority: the root capabilities and constraints */
  authority: {
    issuer: string;         // base64url Ed25519 pubkey of root
    delegatee: string;      // base64url Ed25519 pubkey of recipient
    capabilities: Capability[];
    contractId: string;
    delegationId: string;
    parentDelegationId: string;
    chainDepth: number;
    maxChainDepth: number;
    maxBudgetMicrocents: number;
    expiresAt: string;      // ISO 8601
    issuedAt: string;       // ISO 8601
  };

  /** Attenuation chain: each entry narrows scope, signed by the attenuator */
  attenuations: Attenuation[];

  /** Ed25519 signature over canonical JSON of {authority, attenuations} by the last signer */
  signatures: TokenSignature[];
}

interface Attenuation {
  /** Who is attenuating (must be the delegatee of previous level) */
  attenuator: string;
  /** New delegatee */
  delegatee: string;
  /** New delegation context */
  delegationId: string;
  contractId: string;
  /** Restrictions (all optional — omitted = inherited from parent) */
  allowedCapabilities?: Capability[];  // must be subset of parent
  maxBudgetMicrocents?: number;        // must be ≤ parent
  expiresAt?: string;                  // must be ≤ parent
  maxChainDepth?: number;              // must be < parent remaining
}

interface TokenSignature {
  /** Signer public key */
  signer: string;
  /** Ed25519 signature over BLAKE2b hash of the token content up to this point */
  signature: string;
  /** What this signature covers: 'authority' or index into attenuations[] */
  covers: 'authority' | number;
}
```

**Attenuation is monotonic:** Each `Attenuation` entry can only restrict, never expand. The verification algorithm enforces this (see protocol-spec §10.1).

### 2.3 Biscuit Token Format (v0.2 — Upgrade Path)

```typescript
interface BiscuitToken {
  format: 'delegateos-biscuit-v1';
  /** Base64url-encoded Biscuit v3 protobuf */
  token: string;
}

// Same DCTEngine interface — swap backend, no API change
```

The `DCTEngine` interface (§2.5) abstracts over both formats.

### 2.4 Capability Triple

```typescript
interface Capability {
  namespace: string;  // e.g., "web", "docs", "code"
  action: string;     // e.g., "search", "read", "execute"
  resource: string;   // glob pattern, e.g., "/project/*"
}
```

### 2.5 DCTEngine Interface

```typescript
// core/dct.ts

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

export interface VerificationContext {
  resource: string;
  operation: string;
  now: string;
  spentMicrocents: number;
  rootPublicKey: string;
  revocations: RevocationList;
}

export interface AuthorizedScope {
  capabilities: Capability[];
  remainingBudgetMicrocents: number;
  chainDepth: number;
  maxChainDepth: number;
  contractId: string;
  delegationId: string;
}

export type DenialReason =
  | { type: 'expired' }
  | { type: 'revoked'; revocationId: string }
  | { type: 'capability_not_granted'; requested: Capability; granted: Capability[] }
  | { type: 'budget_exceeded'; limit: number; spent: number }
  | { type: 'chain_depth_exceeded'; max: number; actual: number }
  | { type: 'invalid_signature'; detail: string }
  | { type: 'attenuation_violation'; detail: string }
  | { type: 'malformed_token'; detail: string };

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** Serialized token — opaque to callers */
export interface SerializedDCT {
  token: string;  // base64url of canonical JSON (SJT) or protobuf (Biscuit)
  format: 'delegateos-sjt-v1' | 'delegateos-biscuit-v1';
}

// --- Public API (format-agnostic) ---

export function createDCT(params: DCTCreateParams): SerializedDCT;
export function attenuateDCT(params: DCTAttenuateParams): SerializedDCT;
export function verifyDCT(token: SerializedDCT, context: VerificationContext): Result<AuthorizedScope, DenialReason>;
export function inspectDCT(token: SerializedDCT): {
  issuer: string;
  delegatee: string;
  contractId: string;
  delegationId: string;
  capabilities: Capability[];
  expiresAt: string;
  chainDepth: number;
  revocationIds: string[];
};
export function getRevocationIds(token: SerializedDCT): string[];
```

---

## 3. Revocation (v0.1)

### 3.1 In-Process Revocation List

v0.1 uses a simple in-memory revocation list checked at verification time. No distributed gossip — the deploying process manages the list.

```typescript
// core/revocation.ts

export interface RevocationList {
  /** Check if a revocation ID has been revoked */
  isRevoked(revocationId: string): boolean;
  /** Add a revocation entry (verified: signer must be the block creator) */
  add(entry: RevocationEntry): Result<void, string>;
  /** List all active revocations */
  list(): RevocationEntry[];
  /** Serialize to JSON (for persistence) */
  toJSON(): string;
  /** Load from JSON */
  static fromJSON(json: string): RevocationList;
}

export interface RevocationEntry {
  revocationId: string;       // BLAKE2b-256 of the token block content
  revokedBy: string;          // Must be the signer of that block
  revokedAt: string;          // ISO 8601
  scope: 'block' | 'chain';  // 'chain' revokes all descendant tokens too
  signature: string;          // Ed25519 over canonical JSON of other fields
}

export class InMemoryRevocationList implements RevocationList {
  private entries: Map<string, RevocationEntry> = new Map();
  // ...
}
```

### 3.2 Short-Lived Tokens

As an additional defense, v0.1 tokens default to **1-hour expiry**. Callers can set longer expiry, but the MCP plugin logs a warning for tokens > 4 hours.

### 3.3 v0.2 Revocation Distribution

In v0.2: add `revocationEndpoint` to Agent Cards, polling interval (default 60s), and `delegateos/revoke` JSON-RPC push notifications.

---

## 4. Verification Function Registry (v0.1)

### 4.1 Built-in Verification Methods

v0.1 ships with **3 concrete, fully specified** verification methods. `llm_judge` and `human_review` are deferred to v0.2.

#### 4.1.1 `schema_match` — JSON Schema Validation

```typescript
{
  method: 'schema_match',
  schema: { /* JSON Schema (draft-07) */ }
}
```

**Implementation:** Uses `ajv` (v8) with strict mode. Output is validated against the schema. Pass = valid, fail = ajv error messages returned.

#### 4.1.2 `deterministic_check` — Function Registry

```typescript
{
  method: 'deterministic_check',
  checkName: string,       // registered function name
  checkParams?: unknown,   // params passed to the check function
  expectedResult?: unknown // if set, function result must deep-equal this
}
```

**Built-in check functions (v0.1):**

| Name | Params | What It Does |
|------|--------|-------------|
| `regex_match` | `{ pattern: string, flags?: string, field?: string }` | Tests output (or `output[field]`) against regex. Pass = match. |
| `json_schema` | `{ schema: JSONSchema }` | Same as schema_match (for use in composite). |
| `string_length` | `{ min?: number, max?: number, field?: string }` | Checks string length bounds. |
| `array_length` | `{ min?: number, max?: number, field?: string }` | Checks array length bounds. |
| `field_exists` | `{ fields: string[] }` | Checks that all named fields exist (dot-path supported). |
| `exit_code` | `{ expected: number }` | For process outputs: checks exit code. |
| `output_equals` | `{ expected: unknown }` | Deep-equality check on entire output. |

**Custom check functions:** Users register functions via `CheckFunctionRegistry`:

```typescript
// core/verification.ts

export interface CheckFunction {
  (output: unknown, params?: unknown): CheckResult;
}

export interface CheckResult {
  passed: boolean;
  score?: number;     // 0.0–1.0 optional
  details?: string;   // human-readable explanation
}

export class CheckFunctionRegistry {
  private fns: Map<string, CheckFunction> = new Map();

  /** Register a check function */
  register(name: string, fn: CheckFunction): void;

  /** Get a registered function (throws if not found) */
  get(name: string): CheckFunction;

  /** List all registered function names */
  list(): string[];
}

/** Create a registry pre-loaded with all built-in checks */
export function createDefaultRegistry(): CheckFunctionRegistry;
```

**Security:** Check functions receive output as `unknown` and must not have side effects. They run synchronously. No network access, no filesystem access. For v0.1, this is enforced by convention; v0.2 may add sandboxing.

#### 4.1.3 `composite` — Multiple Checks

```typescript
{
  method: 'composite',
  steps: VerificationSpec[],
  mode: 'all_pass' | 'majority' | 'weighted',
  // For 'weighted' mode:
  weights?: number[],       // must sum to 1.0, one per step
  passThreshold?: number,   // weighted score must exceed this (default 0.7)
}
```

**Failure semantics:**

| Mode | Pass Condition | Short-Circuit |
|------|---------------|---------------|
| `all_pass` | Every step passes | Yes — first failure stops |
| `majority` | >50% of steps pass | No — runs all steps |
| `weighted` | Σ(weight × score) ≥ passThreshold | No — runs all steps |

Steps execute in array order. Each step produces a `CheckResult`. For `all_pass`, steps that don't produce a score default to score=1.0 (pass) or 0.0 (fail).

#### 4.1.4 v0.2 Verification Methods

**`llm_judge` (v0.2):** Will specify:
- Model: configurable, default `claude-sonnet-4-20250514`
- Temperature: 0.0 (deterministic)
- Prompt template: `JUDGE_PROMPT_V1` (standardized, includes contract description, expected output schema, and rubric)
- Scoring: 3 independent evaluations, median score used (handles inconsistency)
- Pass threshold: configurable, default 0.7
- Cost: charged to the delegator's budget

**`human_review` (v0.2):** Callback-based, with timeout and escalation.

---

## 5. Attestation Engine (v0.1)

### 5.1 Core Interface

```typescript
// core/attestation.ts

export interface Attestation {
  id: string;              // "att_" + 12 hex chars
  version: '0.1';
  contractId: string;
  delegationId: string;
  principal: string;       // attesting principal's pubkey
  createdAt: string;       // ISO 8601
  type: 'completion' | 'delegation_verification';
  result: AttestationResult;
  childAttestations: string[];
  /** Ed25519 signature over canonical JSON of all fields except 'signature' */
  signature: string;
}

export interface AttestationResult {
  success: boolean;
  output?: unknown;
  outputHash?: string;     // BLAKE2b-256 of JSON.stringify(output)
  costMicrocents: number;
  durationMs: number;
  verificationOutcome?: {
    method: string;
    passed: boolean;
    score?: number;
    details?: string;
  };
}

export function createCompletionAttestation(
  signer: Keypair,
  contractId: string,
  delegationId: string,
  result: AttestationResult,
): Attestation;

export function verifyAttestationSignature(
  attestation: Attestation,
  signerPublicKey: string,
): boolean;
```

---

## 6. MCP Middleware Plugin (v0.1)

### 6.1 Full Lifecycle

The plugin handles the complete MCP session, not just `tools/call`:

```
MCP Client → DelegateOS Proxy → Upstream MCP Server

Handled methods:
  initialize    → Forward, inject DelegateOS server info
  tools/list    → Forward, then filter tools based on DCT capabilities
  tools/call    → Verify DCT, strip _delegateos, forward, record spend
  *             → Pass through (resources, prompts, etc.)
```

### 6.2 Interface

```typescript
// mcp/plugin.ts

export interface ToolCapabilityMap {
  [toolName: string]: {
    namespace: string;
    action: string;
    resourceExtractor?: (args: Record<string, unknown>) => string;
  };
}

export interface MCPPluginConfig {
  toolCapabilities: ToolCapabilityMap;
  trustedRoots: string[];
  revocations: RevocationList;
  budgetTracker: BudgetTracker;
}

export interface BudgetTracker {
  getSpent(delegationId: string): number;
  recordSpend(delegationId: string, microcents: number): void;
}

export interface MCPRequest {
  jsonrpc: '2.0';
  method: string;
  id?: string | number;
  params: {
    name?: string;
    arguments?: Record<string, unknown>;
    _delegateos?: {
      dct: string;       // base64url token
      format: string;    // token format
      delegationId: string;
      contractId: string;
    };
    [key: string]: unknown;
  };
}

export function createMCPPlugin(config: MCPPluginConfig): {
  handleRequest(req: MCPRequest): Promise<MCPRequest | MCPErrorResponse>;
  handleResponse(req: MCPRequest, res: unknown): Promise<unknown>;
  addRevocation(entry: RevocationEntry): void;
};
```

### 6.3 Request Flow

```
Incoming tools/call
       │
       ▼
  Has _delegateos? ──No──▶ Pass through unchanged
       │ Yes
       ▼
  Deserialize DCT ──Fail──▶ Error -32001
       │ Ok
       ▼
  Map tool name → Capability ──Not found──▶ Error -32001
       │ Found
       ▼
  verifyDCT(token, context) ──Denied──▶ Error -32001 + reason
       │ Authorized
       ▼
  Strip _delegateos, forward to upstream
       │
       ▼
  Record spend, return response
```

### 6.4 tools/list Filtering

When a DCT is active for the session, `tools/list` responses are filtered to only include tools the DCT grants access to. This prevents the agent from even seeing tools it can't use.

### 6.5 Transport

v0.1 supports **stdio proxy** only (wraps a child MCP server process). HTTP+SSE proxy is v0.2.

```typescript
// mcp/proxy.ts

export interface ProxyConfig {
  plugin: MCPPlugin;
  upstream: { command: string; args: string[] };
}

export function createStdioProxy(config: ProxyConfig): {
  start(): Promise<void>;
  stop(): Promise<void>;
};
```

---

## 7. Delegation Chain (v0.1 — Simplified)

v0.1 uses a simplified in-memory chain store. No tree queries, no hierarchical budget aggregation (v0.2).

```typescript
// core/chain.ts

export interface Delegation {
  id: string;                    // "del_" + 12 hex chars
  parentId: string;              // "del_000000000000" for root
  from: string;                  // delegator pubkey
  to: string;                    // delegatee pubkey
  contractId: string;
  dct: SerializedDCT;
  depth: number;
  status: 'active' | 'completed' | 'failed' | 'revoked';
  createdAt: string;
  completedAt?: string;
  attestationId?: string;
}

export interface ChainStore {
  put(delegation: Delegation): Promise<void>;
  get(delegationId: string): Promise<Delegation | null>;
  getChildren(delegationId: string): Promise<Delegation[]>;
  updateStatus(delegationId: string, status: Delegation['status'], attestationId?: string): Promise<void>;
}

export class MemoryChainStore implements ChainStore { /* ... */ }
```

---

## 8. Contract (v0.1 — Simplified)

v0.1 contracts are **flat** — no decomposition. A contract describes a task and how to verify it. Decomposition is v0.2.

```typescript
// core/contract.ts

export interface TaskContract {
  id: string;                  // "ct_" + 12 hex chars
  version: '0.1';
  issuer: string;              // signer pubkey
  createdAt: string;
  task: TaskSpec;
  verification: VerificationSpec;
  constraints: TaskConstraints;
  signature: string;           // Ed25519 over canonical JSON (excl signature field)
}

export interface TaskSpec {
  title: string;
  description: string;
  inputs: Record<string, unknown>;
  outputSchema: JSONSchema;    // JSON Schema draft-07
}

export interface VerificationSpec {
  method: 'schema_match' | 'deterministic_check' | 'composite';
  // schema_match
  schema?: JSONSchema;
  // deterministic_check
  checkName?: string;
  checkParams?: unknown;
  expectedResult?: unknown;
  // composite
  steps?: VerificationSpec[];
  mode?: 'all_pass' | 'majority' | 'weighted';
  weights?: number[];
  passThreshold?: number;
}

export interface TaskConstraints {
  maxBudgetMicrocents: number;
  deadline: string;
  maxChainDepth: number;
  requiredCapabilities: string[];  // e.g., ["web:search", "docs:read"]
}

export function createContract(issuer: Keypair, task: TaskSpec, verification: VerificationSpec, constraints: TaskConstraints): TaskContract;
export function verifyContractSignature(contract: TaskContract, issuerPublicKey: string): boolean;

export async function verifyOutput(
  contract: TaskContract,
  output: unknown,
  registry: CheckFunctionRegistry,
): Promise<Result<CheckResult, Error>>;
```

---

## 9. Crypto Utilities

```typescript
// core/crypto.ts

// Uses @noble/ed25519 (pure JS, no WASM, well-maintained)
// Uses blakejs for BLAKE2b

export function generateKeypair(): Keypair;
export function sign(privateKey: Uint8Array, message: Uint8Array): Uint8Array;
export function verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean;
export function blake2b256(data: Uint8Array): Uint8Array;
export function canonicalize(obj: unknown): string;  // RFC 8785
export function principalId(publicKey: Uint8Array): string;  // base64url, no padding
```

---

## 10. Package Structure

```
delegateos/
├── package.json
├── tsconfig.json
├── src/
│   ├── core/
│   │   ├── types.ts          # All type definitions (single source of truth)
│   │   ├── crypto.ts         # Ed25519, BLAKE2b, canonicalization
│   │   ├── dct.ts            # DCT create/attenuate/verify (SJT backend)
│   │   ├── revocation.ts     # In-memory revocation list
│   │   ├── verification.ts   # CheckFunctionRegistry + built-in checks
│   │   ├── contract.ts       # Contract create/sign/verify
│   │   ├── attestation.ts    # Attestation create/verify
│   │   └── chain.ts          # Delegation chain store (in-memory)
│   ├── mcp/
│   │   ├── plugin.ts         # MCP middleware
│   │   └── proxy.ts          # Stdio MCP proxy
│   └── demo/
│       ├── orchestrator.ts   # Demo orchestrator agent
│       ├── specialist.ts     # Demo specialist agent
│       └── run.ts            # Demo runner
├── test/
│   ├── core/
│   │   ├── dct.test.ts
│   │   ├── verification.test.ts
│   │   ├── contract.test.ts
│   │   ├── attestation.test.ts
│   │   └── revocation.test.ts
│   └── mcp/
│       └── plugin.test.ts
└── docs/
    ├── architecture.md
    └── protocol-spec.md
```

**Dependencies (v0.1):**

```json
{
  "dependencies": {
    "@noble/ed25519": "^2.0.0",
    "blakejs": "^1.2.0",
    "ajv": "^8.12.0",
    "canonicalize": "^2.0.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.0.0"
  }
}
```

No WASM. No Biscuit. Pure JS dependencies only.

---

## 11. Security Model

### 11.1 Monotonic Attenuation (Signed JSON Approach)

Unlike Biscuit's Datalog-enforced attenuation, the SJT approach enforces monotonicity at **verification time**:

1. Each attenuation block is signed by the attenuator
2. The verifier walks the attenuation chain and computes the **effective scope** by intersecting capabilities at each level
3. If any attenuation tries to expand scope (add capabilities, increase budget, extend expiry), verification fails with `attenuation_violation`

**Example:**
```
Root: capabilities=[web:search:*, docs:read:/project/*], budget=$10, depth=3
  ↓ Attenuation by Orchestrator:
    capabilities=[web:search:*], budget=$2, depth=1
  ↓ Attenuation by Specialist:
    capabilities=[web:search:arxiv.org/*], budget=$0.50, depth=0
```

### 11.2 Threat Mitigations

| Threat | Mitigation |
|--------|-----------|
| Token forgery | Ed25519 signatures on every block; chain verified root→leaf |
| Token replay | `delegationId` uniqueness + expiry |
| Scope escalation | Verification enforces monotonic narrowing |
| Budget drain | Per-delegation spend tracking in BudgetTracker |
| Stolen token | Bound to `delegationId` + `contractId`; short expiry (1h default) |
| Revoked token reuse | RevocationList checked on every verification |

### 11.3 Key Management

- Ed25519 keypairs generated via `@noble/ed25519`
- Private keys: stored encrypted at rest (implementation-defined; env var for demos)
- Public keys: exchanged out-of-band for v0.1 (Agent Cards in v0.2)
- Rotation: new keypair, old tokens valid until expiry

---

## 12. Implementation Roadmap

### Phase 1: Core (Week 1)
- `core/types.ts` — All types, single source of truth
- `core/crypto.ts` — Ed25519 + BLAKE2b wrappers
- `core/dct.ts` — SJT create, attenuate, verify
- `core/revocation.ts` — In-memory revocation list
- Unit tests for all

### Phase 2: Verification + Contract (Week 2)
- `core/verification.ts` — Registry + 7 built-in checks
- `core/contract.ts` — Contract create, sign, verify output
- `core/attestation.ts` — Attestation create, verify signature
- `core/chain.ts` — In-memory chain store
- Unit tests

### Phase 3: MCP Plugin (Week 3)
- `mcp/plugin.ts` — Full middleware with tools/list filtering
- `mcp/proxy.ts` — Stdio proxy
- Integration test with a real MCP server

### Phase 4: Demo (Week 4)
- `demo/` — Working orchestrator→specialist delegation
- Documentation, README, getting-started guide

---

*End of Architecture Document v0.2*
