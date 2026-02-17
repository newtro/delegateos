# DelegateOS Protocol Specification v0.2

**Status:** Draft — Post-review iteration  
**Date:** 2026-02-17  
**Scope:** v0.1 protocol (v0.2 extensions noted inline)

---

## 1. Overview

DelegateOS defines a delegation and accountability protocol for multi-agent systems. It operates as middleware between agent frameworks and MCP servers, adding scoped capability delegation and verifiable task completion.

### 1.1 Terminology

| Term | Definition |
|------|-----------|
| **Principal** | Entity identified by an Ed25519 public key |
| **DCT** | Delegation Capability Token — signed JSON token encoding scoped authority |
| **Contract** | Task specification with verification method and constraints |
| **Attestation** | Cryptographically signed proof of task completion |
| **SJT** | Signed JSON Token — v0.1 token format |

### 1.2 Cryptographic Primitives

- **Signing:** Ed25519 (RFC 8032) via `@noble/ed25519`
- **Hashing:** BLAKE2b-256 via `blakejs`
- **Serialization:** Canonical JSON (RFC 8785) for all signed structures
- **Timestamps:** ISO 8601 UTC

### 1.3 Scope

**v0.1:** DCT engine, MCP middleware, attestation signing, revocation list, demo  
**v0.2 (deferred):** Trust scoring, A2A integration, contract decomposition, Biscuit backend, payments

---

## 2. Principal Identity

```typescript
interface Principal {
  /** Base64url-encoded Ed25519 public key (32 bytes → 43 chars, no padding) */
  id: string;
  name?: string;
  metadata?: Record<string, string>;
}

interface Keypair {
  principal: Principal;
  privateKey: Uint8Array;  // 32-byte Ed25519 seed
}
```

Key generation: `@noble/ed25519` `getPublicKey(seed)`. Principal ID = `base64url(publicKey)`.

---

## 3. Delegation Capability Token (DCT)

### 3.1 Signed JSON Token Format (v0.1)

```typescript
interface SignedJSONToken {
  format: 'delegateos-sjt-v1';

  authority: {
    issuer: string;              // root principal ID
    delegatee: string;           // recipient principal ID
    capabilities: Capability[];
    contractId: string;
    delegationId: string;
    parentDelegationId: string;  // "del_000000000000" for root
    chainDepth: number;          // 0 for root
    maxChainDepth: number;
    maxBudgetMicrocents: number;
    expiresAt: string;
    issuedAt: string;
  };

  attenuations: Attenuation[];

  signatures: TokenSignature[];
}

interface Capability {
  namespace: string;
  action: string;
  resource: string;   // glob pattern (supports * and **)
}

interface Attenuation {
  attenuator: string;             // must be delegatee of previous level
  delegatee: string;
  delegationId: string;
  contractId: string;
  allowedCapabilities?: Capability[];
  maxBudgetMicrocents?: number;
  expiresAt?: string;
  maxChainDepth?: number;
}

interface TokenSignature {
  signer: string;
  signature: string;             // base64url Ed25519 signature
  covers: 'authority' | number;  // 'authority' or attenuation index
}
```

### 3.2 Serialized Form

```typescript
interface SerializedDCT {
  /** base64url of canonical JSON of the SignedJSONToken */
  token: string;
  format: 'delegateos-sjt-v1';
}
```

### 3.3 Token Creation

```
CREATE_DCT(params):
  1. Build authority object from params
  2. Compute signedPayload = canonicalize({ authority })
  3. Sign: signature = Ed25519.sign(issuer.privateKey, BLAKE2b(signedPayload))
  4. Return SignedJSONToken {
       format: 'delegateos-sjt-v1',
       authority: ...,
       attenuations: [],
       signatures: [{ signer: issuer.id, signature: base64url(signature), covers: 'authority' }]
     }
```

### 3.4 Token Attenuation

```
ATTENUATE_DCT(token, params):
  1. Parse existing token
  2. Validate attenuator == current delegatee (last attenuation's delegatee, or authority.delegatee)
  3. Build attenuation object
  4. Validate monotonic narrowing:
     - allowedCapabilities ⊆ effective capabilities of parent (see §10.1 step 3)
     - maxBudgetMicrocents ≤ parent effective budget
     - expiresAt ≤ parent effective expiry
     - maxChainDepth < parent effective remaining depth
  5. Append attenuation to attenuations[]
  6. Compute signedPayload = canonicalize({ authority, attenuations: [...existing, new] })
  7. Sign with attenuator's key
  8. Append signature to signatures[]
  9. Return updated token
```

### 3.5 Revocation IDs

Each token block (authority + each attenuation) has a revocation ID:

```
revocationId(authority) = base64url(BLAKE2b(canonicalize(authority)))
revocationId(attenuation[i]) = base64url(BLAKE2b(canonicalize(attenuation[i])))
```

### 3.6 Lifecycle

```
CREATE → ATTENUATE* → PRESENT → VERIFY → EXPIRE | REVOKE
```

Default token lifetime: 1 hour. Maximum recommended: 24 hours.

---

## 4. Revocation

### 4.1 Revocation Entry

```typescript
interface RevocationEntry {
  revocationId: string;
  revokedBy: string;       // must be the signer of the revoked block
  revokedAt: string;
  scope: 'block' | 'chain';
  /** Ed25519 signature over canonicalize({ revocationId, revokedBy, revokedAt, scope }) */
  signature: string;
}
```

### 4.2 Revocation List (v0.1)

In-memory set of revocation IDs. Checked during DCT verification (§10.1 step 2).

```typescript
interface RevocationList {
  isRevoked(revocationId: string): boolean;
  add(entry: RevocationEntry): Result<void, string>;
  list(): RevocationEntry[];
  toJSON(): string;
  static fromJSON(json: string): RevocationList;
}
```

**`scope: 'chain'`** means: when this revocation ID matches any block in a token, the entire token (and any tokens attenuated from it) are considered revoked.

### 4.3 v0.2 Distribution

- Agent Cards gain `revocationEndpoint: string`
- `delegateos/revoke` JSON-RPC notification pushed to known peers
- Polling: verifiers check `revocationEndpoint` every 60s
- Consistency: eventually consistent, bounded by poll interval

---

## 5. Task Contract

### 5.1 Schema

```typescript
interface TaskContract {
  id: string;                    // "ct_" + 12 hex chars
  version: '0.1';
  issuer: string;
  createdAt: string;
  task: TaskSpec;
  verification: VerificationSpec;
  constraints: TaskConstraints;
  /** Ed25519 signature over canonical JSON of all fields except 'signature' */
  signature: string;
}

interface TaskSpec {
  title: string;
  description: string;
  inputs: Record<string, unknown>;
  outputSchema: JSONSchema;       // JSON Schema draft-07
}

interface TaskConstraints {
  maxBudgetMicrocents: number;
  deadline: string;               // ISO 8601
  maxChainDepth: number;
  requiredCapabilities: string[]; // "namespace:action" format
}
```

### 5.2 Contract-DCT Binding

A DCT is bound to a contract via `authority.contractId`. The verifier MUST reject a DCT if:
- `contractId` doesn't match the contract being executed
- The DCT's capabilities don't cover the contract's `requiredCapabilities`

---

## 6. Verification

### 6.1 VerificationSpec

```typescript
interface VerificationSpec {
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
```

### 6.2 Built-in Check Functions

All check functions have signature: `(output: unknown, params?: unknown) => CheckResult`

```typescript
interface CheckResult {
  passed: boolean;
  score?: number;    // 0.0–1.0
  details?: string;
}
```

#### `regex_match`
**Params:** `{ pattern: string, flags?: string, field?: string }`  
**Behavior:** If `field` is set, extracts `output[field]` (dot-path). Tests against `new RegExp(pattern, flags)`.  
**Pass:** Match found. **Score:** 1.0 if match, 0.0 if not.

#### `json_schema`
**Params:** `{ schema: JSONSchema }`  
**Behavior:** Validates output against JSON Schema draft-07 using `ajv` strict mode.  
**Pass:** Valid. **Score:** 1.0 if valid, 0.0 if not. **Details:** ajv error messages on failure.

#### `string_length`
**Params:** `{ min?: number, max?: number, field?: string }`  
**Behavior:** Extracts string (from field or entire output if string). Checks `min ≤ length ≤ max`.  
**Pass:** Within bounds.

#### `array_length`
**Params:** `{ min?: number, max?: number, field?: string }`  
**Behavior:** Same as string_length but for arrays.

#### `field_exists`
**Params:** `{ fields: string[] }`  
**Behavior:** For each field (dot-path), checks the value exists and is not `undefined`.  
**Pass:** All fields exist.

#### `exit_code`
**Params:** `{ expected: number }`  
**Behavior:** Expects `output` to have shape `{ exitCode: number }`. Checks equality.

#### `output_equals`
**Params:** `{ expected: unknown }`  
**Behavior:** Deep-equality comparison (`JSON.stringify` canonical form).

### 6.3 Check Function Registry

```typescript
class CheckFunctionRegistry {
  register(name: string, fn: CheckFunction): void;
  get(name: string): CheckFunction;  // throws if not found
  list(): string[];
}

function createDefaultRegistry(): CheckFunctionRegistry;
// Pre-registers: regex_match, json_schema, string_length, array_length,
//                field_exists, exit_code, output_equals
```

### 6.4 Composite Verification Semantics

| Mode | Pass Condition | Execution |
|------|---------------|-----------|
| `all_pass` | Every step returns `passed: true` | Short-circuits on first failure |
| `majority` | >50% of steps pass | Runs all steps |
| `weighted` | Σ(weights[i] × score[i]) ≥ passThreshold | Runs all steps |

For `weighted`: steps that return no `score` use 1.0 (passed) or 0.0 (failed).  
Default `passThreshold`: 0.7.  
`weights` must have same length as `steps` and sum to 1.0 (±0.001 tolerance).

### 6.5 v0.2: `llm_judge`

```typescript
// v0.2 addition to VerificationSpec
{
  method: 'llm_judge',
  judgeModel?: string,       // default: 'claude-sonnet-4-20250514'
  judgeTemperature?: number, // default: 0.0
  judgePrompt: string,       // must include {output} and {contract} placeholders
  passThreshold: number,     // 0.0–1.0
  evaluations?: number,      // default: 3 (odd number, uses median)
}
```

**Prompt template (v0.2):**
```
You are evaluating whether an AI agent's output satisfies a task contract.

## Contract
Title: {contract.task.title}
Description: {contract.task.description}
Expected output schema: {contract.task.outputSchema}

## Agent Output
{output}

## Custom Rubric
{judgePrompt}

Rate the output quality from 0.0 to 1.0. Respond with ONLY a JSON object:
{"score": <number>, "reasoning": "<brief explanation>"}
```

**Inconsistency handling:** Run `evaluations` independent calls. Take the median score. If max-min spread > 0.3, log a warning and use the median anyway (v0.2 may add re-evaluation).

### 6.6 v0.2: `human_review`

Callback-based with configurable timeout (default 24h). Escalates to `llm_judge` on timeout.

---

## 7. Attestation

### 7.1 Schema

```typescript
interface Attestation {
  id: string;                  // "att_" + 12 hex chars
  version: '0.1';
  contractId: string;
  delegationId: string;
  principal: string;           // attesting principal ID
  createdAt: string;
  type: 'completion' | 'delegation_verification';
  result: AttestationResult;
  childAttestations: string[];
  signature: string;
}

interface AttestationResult {
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
```

### 7.2 Signing

Signature covers: `canonicalize(attestation_without_signature_field)` → BLAKE2b → Ed25519.sign.

### 7.3 Attestation Chain Integrity (v0.1 — simplified)

For v0.1, attestation chains are verified one level deep:
1. Verify signature against claimed principal's public key
2. Verify `output` against contract's `outputSchema` (if schema_match)
3. Run contract's verification spec against output
4. Check `costMicrocents ≤ contract.constraints.maxBudgetMicrocents`

Full recursive chain verification is v0.2.

---

## 8. Delegation Chain

### 8.1 Schema

```typescript
interface Delegation {
  id: string;              // "del_" + 12 hex chars
  parentId: string;        // "del_000000000000" for root
  from: string;            // delegator principal ID
  to: string;              // delegatee principal ID
  contractId: string;
  dct: SerializedDCT;
  depth: number;           // 0 = root
  status: 'active' | 'completed' | 'failed' | 'revoked';
  createdAt: string;
  completedAt?: string;
  attestationId?: string;
}
```

### 8.2 Chain Invariants

1. Root delegation: `parentId === "del_000000000000"`, `depth === 0`
2. Child: `child.from === parent.to`
3. `child.depth === parent.depth + 1`
4. Depth ≤ root DCT's `maxChainDepth`
5. Child DCT must be attenuated from parent DCT

---

## 9. Message Schemas (JSON-RPC 2.0)

### 9.1 Delegation Request

```json
{
  "jsonrpc": "2.0",
  "method": "delegateos/delegate",
  "id": 1,
  "params": {
    "contract": { "...TaskContract" },
    "dct": "base64url-token",
    "dctFormat": "delegateos-sjt-v1",
    "delegationId": "del_f7e8d9c0b1a2",
    "parentDelegationId": "del_000000000000"
  }
}
```

### 9.2 Delegation Accept

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "accepted": true,
    "delegationId": "del_f7e8d9c0b1a2",
    "estimatedDurationMs": 30000,
    "estimatedCostMicrocents": 50000
  }
}
```

### 9.3 Delegation Reject

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "accepted": false,
    "reason": "capability_mismatch",
    "details": "Agent does not support web:search"
  }
}
```

### 9.4 Completion

```json
{
  "jsonrpc": "2.0",
  "method": "delegateos/complete",
  "params": {
    "delegationId": "del_f7e8d9c0b1a2",
    "attestation": { "...Attestation" }
  }
}
```

### 9.5 Revocation (v0.1 — local only; v0.2 — distributed)

```json
{
  "jsonrpc": "2.0",
  "method": "delegateos/revoke",
  "params": {
    "revocation": { "...RevocationEntry" }
  }
}
```

---

## 10. Verification Algorithms

### 10.1 DCT Verification (SJT)

```
VERIFY_DCT(token: SerializedDCT, ctx: VerificationContext) → Result<AuthorizedScope, DenialReason>

1. DESERIALIZE: base64url decode → parse JSON → validate structure
   Fail → DenialReason { type: 'malformed_token' }

2. CHECK REVOCATIONS:
   For each block (authority + each attenuation):
     revId = base64url(BLAKE2b(canonicalize(block)))
     If ctx.revocations.isRevoked(revId) → DenialReason { type: 'revoked' }

3. VERIFY SIGNATURES:
   a. Verify signatures[0] covers 'authority':
      payload = canonicalize({ authority })
      Ed25519.verify(authority.issuer, BLAKE2b(payload), signatures[0].signature)
      Also verify: authority.issuer == ctx.rootPublicKey
   b. For each attenuation[i]:
      payload = canonicalize({ authority, attenuations: attenuations[0..i] })
      Ed25519.verify(attenuations[i].attenuator, BLAKE2b(payload), signatures[i+1].signature)
   Fail → DenialReason { type: 'invalid_signature' }

4. VERIFY ATTENUATION CHAIN:
   effectiveCaps = authority.capabilities
   effectiveBudget = authority.maxBudgetMicrocents
   effectiveExpiry = authority.expiresAt
   effectiveMaxDepth = authority.maxChainDepth
   currentDelegatee = authority.delegatee

   For each attenuation[i]:
     a. attenuation[i].attenuator MUST == currentDelegatee
        Fail → DenialReason { type: 'attenuation_violation', detail: 'attenuator mismatch' }
     b. If allowedCapabilities set:
        Each cap MUST be subset of effectiveCaps (namespace match, action match, resource is sub-glob)
        Fail → DenialReason { type: 'attenuation_violation', detail: 'capability expansion' }
        effectiveCaps = allowedCapabilities
     c. If maxBudgetMicrocents set:
        MUST be ≤ effectiveBudget
        effectiveBudget = maxBudgetMicrocents
     d. If expiresAt set:
        MUST be ≤ effectiveExpiry
        effectiveExpiry = expiresAt
     e. If maxChainDepth set:
        MUST be < effectiveMaxDepth
        effectiveMaxDepth = maxChainDepth
     f. currentDelegatee = attenuation[i].delegatee

5. CHECK EXPIRY:
   If ctx.now > effectiveExpiry → DenialReason { type: 'expired' }

6. CHECK BUDGET:
   If ctx.spentMicrocents >= effectiveBudget → DenialReason { type: 'budget_exceeded' }

7. CHECK CAPABILITY:
   requested = { namespace: infer from tool map, action: ctx.operation, resource: ctx.resource }
   Match against effectiveCaps using glob matching on resource field
   No match → DenialReason { type: 'capability_not_granted' }

8. RETURN AuthorizedScope {
     capabilities: effectiveCaps,
     remainingBudgetMicrocents: effectiveBudget - ctx.spentMicrocents,
     chainDepth: authority.chainDepth + attenuations.length,
     maxChainDepth: effectiveMaxDepth,
     contractId: last contractId in chain,
     delegationId: last delegationId in chain,
   }
```

### 10.2 Glob Matching for Resources

Resource patterns use simple glob rules:
- `*` matches any single path segment
- `**` matches zero or more path segments
- Exact string matches exactly

Examples:
- Pattern `/project/*` matches `/project/foo` but not `/project/foo/bar`
- Pattern `/project/**` matches `/project/foo/bar/baz`
- Pattern `*` matches anything

A capability `C_child` is a subset of `C_parent` iff:
- `C_child.namespace == C_parent.namespace`
- `C_child.action == C_parent.action`
- `C_child.resource` matches a subset of paths that `C_parent.resource` matches

For v0.1, subset checking is conservative: `C_child.resource` must be a literal prefix-narrowing of `C_parent.resource` or identical. Full glob subset analysis is v0.2.

### 10.3 Contract Output Verification

```
VERIFY_OUTPUT(contract, output, registry) → Result<CheckResult, Error>

switch contract.verification.method:
  case 'schema_match':
    return ajv.validate(contract.verification.schema, output)
      ? { passed: true, score: 1.0 }
      : { passed: false, score: 0.0, details: ajv.errorsText() }

  case 'deterministic_check':
    fn = registry.get(contract.verification.checkName)  // throws if not found
    result = fn(output, contract.verification.checkParams)
    if contract.verification.expectedResult !== undefined:
      result.passed = deepEqual(result, contract.verification.expectedResult)
    return result

  case 'composite':
    results = []
    for step in contract.verification.steps:
      r = VERIFY_OUTPUT({...contract, verification: step}, output, registry)
      results.push(r)
      if contract.verification.mode == 'all_pass' && !r.passed:
        return { passed: false, score: 0.0, details: `Step ${i} failed: ${r.details}` }

    switch contract.verification.mode:
      case 'all_pass':
        return { passed: true, score: 1.0 }
      case 'majority':
        passCount = results.filter(r => r.passed).length
        return { passed: passCount > results.length / 2, score: passCount / results.length }
      case 'weighted':
        weightedScore = sum(contract.verification.weights[i] * (results[i].score ?? (results[i].passed ? 1 : 0)))
        return { passed: weightedScore >= (contract.verification.passThreshold ?? 0.7), score: weightedScore }
```

---

## 11. MCP Integration Wire Format

### 11.1 Augmented tools/call

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": 3,
  "params": {
    "name": "web_search",
    "arguments": { "query": "quantum computing 2025" },
    "_delegateos": {
      "dct": "base64url-token",
      "format": "delegateos-sjt-v1",
      "delegationId": "del_f7e8d9c0b1a2",
      "contractId": "ct_a1b2c3d4e5f6"
    }
  }
}
```

### 11.2 Error Response

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "error": {
    "code": -32001,
    "message": "DCT verification failed",
    "data": {
      "type": "capability_not_granted",
      "requested": { "namespace": "web", "action": "search", "resource": "*" },
      "granted": [{ "namespace": "docs", "action": "read", "resource": "/project/*" }]
    }
  }
}
```

### 11.3 Proxy Lifecycle

```
1. Client connects to DelegateOS proxy (stdio)
2. Proxy spawns upstream MCP server as child process
3. Forward 'initialize' → upstream, return response to client
4. On 'tools/list':
   - Forward to upstream, get full list
   - If session has active DCT: filter to only tools matching DCT capabilities
   - Return filtered list
5. On 'tools/call':
   - Extract _delegateos (if present)
   - Verify DCT (if present)
   - Strip _delegateos, forward to upstream
   - Record spend, return response
6. All other methods: pass through
```

---

## 12. Capability Namespace Registry

| Namespace | Actions | Resource Pattern |
|-----------|---------|-----------------|
| `web` | `search`, `fetch`, `browse` | URL pattern or `*` |
| `docs` | `read`, `write`, `delete` | Path glob |
| `code` | `execute`, `analyze`, `test` | Language/env |
| `llm` | `generate`, `embed`, `classify` | Model pattern |
| `data` | `query`, `insert`, `update`, `delete` | Table/collection |
| `compute` | `spawn`, `execute` | Resource class |

Custom: any `orgname:namespace` string.

---

## 13. Security Considerations

### 13.1 Monotonic Attenuation (SJT)

The SJT format enforces attenuation at verification time by walking the chain and intersecting capabilities. Each attenuation block is signed by the attenuator, so modifications are detected. The verifier rejects any attenuation that expands scope.

**Comparison with Biscuit:** Biscuit enforces monotonicity via Datalog semantics (structurally impossible to expand). SJT enforces it via verification-time checks (algorithmically enforced). Both are sound assuming correct implementation. Biscuit is stronger in theory (structural guarantee); SJT is simpler to implement and debug.

### 13.2 Token Replay

- `delegationId` is unique per delegation
- Short-lived tokens (1h default) limit replay window
- Verifiers MAY maintain a seen-nonce set for additional protection (recommended for high-value delegations)

### 13.3 Key Compromise

- Revoke all blocks signed by compromised key
- Short token lifetime limits exposure
- v0.2: automated key rotation with Agent Card updates

### 13.4 Budget Exhaustion

- `BudgetTracker` records spend per delegationId
- Verification rejects requests exceeding remaining budget
- v0.2: hierarchical budget tracking across delegation trees

---

## 14. v0.2 Extensions (Deferred)

### 14.1 Trust Scoring
Bayesian reputation system with temporal decay. Deferred because:
- Trivially gameable without Sybil resistance (which requires identity verification infrastructure)
- Requires real interaction data to calibrate weights
- v0.1 can function with externally-provided trust scores or no trust requirement

### 14.2 A2A Integration
Agent Card extensions with `delegateos` field. Deferred because v0.1 focuses on MCP-only scenarios.

### 14.3 Contract Decomposition
Recursive task splitting with budget propagation. Deferred because v0.1 uses flat contracts.

### 14.4 Biscuit Backend
Drop-in replacement for SJT via the DCTEngine interface. Requires validating `@biscuit-auth/biscuit-wasm` in Node.js.

### 14.5 Persistent Storage
SQLite store implementations for ChainStore, AttestationStore, RevocationList.

---

*End of Protocol Specification v0.2*
