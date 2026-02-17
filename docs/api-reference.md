# DelegateOS API Reference

Complete reference for all public modules in DelegateOS v0.1.

---

## core/dct

Delegation Capability Token creation, attenuation, and verification using the Signed JSON Token (SJT) format.

### `createDCT(params: DCTCreateParams): SerializedDCT`

Create a new root DCT.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `params.issuer` | `Keypair` | Keypair of the token issuer (root authority) |
| `params.delegatee` | `Principal` | Recipient of the delegation |
| `params.capabilities` | `Capability[]` | Granted capabilities (namespace/action/resource triples) |
| `params.contractId` | `string` | Contract this token is bound to |
| `params.delegationId` | `string` | Unique delegation identifier |
| `params.parentDelegationId` | `string` | Parent delegation ID (`"del_000000000000"` for root) |
| `params.chainDepth` | `number` | Current depth in the chain (0 for root) |
| `params.maxChainDepth` | `number` | Maximum allowed chain depth |
| `params.maxBudgetMicrocents` | `number` | Maximum budget in microcents |
| `params.expiresAt` | `string` | ISO 8601 expiry timestamp |

**Returns:** `SerializedDCT` — Opaque serialized token with `token` (base64url) and `format` fields.

**Example:**
```typescript
import { generateKeypair } from 'delegateos/core/crypto';
import { createDCT } from 'delegateos/core/dct';

const issuer = generateKeypair();
const delegatee = generateKeypair();

const dct = createDCT({
  issuer,
  delegatee: delegatee.principal,
  capabilities: [{ namespace: 'web', action: 'search', resource: '*' }],
  contractId: 'ct_abc123',
  delegationId: 'del_abc123',
  parentDelegationId: 'del_000000000000',
  chainDepth: 0,
  maxChainDepth: 3,
  maxBudgetMicrocents: 500_000,
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
});
```

---

### `attenuateDCT(params: DCTAttenuateParams): SerializedDCT`

Attenuate (narrow) an existing DCT for sub-delegation. Scope can only be reduced, never expanded.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `params.token` | `SerializedDCT` | The token to attenuate |
| `params.attenuator` | `Keypair` | Keypair of the current delegatee (must match) |
| `params.delegatee` | `Principal` | New recipient |
| `params.delegationId` | `string` | New delegation ID |
| `params.contractId` | `string` | Contract ID |
| `params.allowedCapabilities?` | `Capability[]` | Narrowed capabilities (must be subset of parent) |
| `params.maxBudgetMicrocents?` | `number` | Reduced budget (must be ≤ parent) |
| `params.expiresAt?` | `string` | Earlier expiry (must be ≤ parent) |
| `params.maxChainDepth?` | `number` | Lower chain depth limit (must be < parent) |

**Returns:** `SerializedDCT` — New token with appended attenuation block.

**Throws:** If attenuation would expand scope, or attenuator isn't the current delegatee.

**Example:**
```typescript
const narrowDCT = attenuateDCT({
  token: dct,
  attenuator: delegatee,
  delegatee: subAgent.principal,
  delegationId: 'del_sub_001',
  contractId: 'ct_abc123',
  allowedCapabilities: [{ namespace: 'web', action: 'search', resource: 'arxiv.org/**' }],
  maxBudgetMicrocents: 100_000,
});
```

---

### `verifyDCT(token: SerializedDCT, context: VerificationContext): Result<AuthorizedScope, DenialReason>`

Verify a DCT against a verification context. Checks: deserialization, revocations, all signatures, attenuation chain monotonicity, expiry, budget, and capability match.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `token` | `SerializedDCT` | Token to verify |
| `context.resource` | `string` | Resource being accessed |
| `context.namespace?` | `string` | Capability namespace |
| `context.operation` | `string` | Operation being performed |
| `context.now` | `string` | Current ISO 8601 timestamp |
| `context.spentMicrocents` | `number` | Amount already spent for this delegation |
| `context.rootPublicKey` | `string` | Expected root issuer's public key |
| `context.revocationIds?` | `string[]` | Active revocation IDs to check against |
| `context.maxChainDepth?` | `number` | Max allowed chain depth (default 10) |

**Returns:** `Result<AuthorizedScope, DenialReason>`

On success (`result.ok === true`), `result.value` contains:
- `capabilities` — Effective capabilities after all attenuations
- `remainingBudgetMicrocents` — Budget minus spent
- `chainDepth` — Actual chain depth
- `maxChainDepth` — Effective max chain depth
- `contractId` — Effective contract ID
- `delegationId` — Effective delegation ID

On failure (`result.ok === false`), `result.error` is one of:
- `{ type: 'expired' }`
- `{ type: 'revoked', revocationId }`
- `{ type: 'capability_not_granted', requested, granted }`
- `{ type: 'budget_exceeded', limit, spent }`
- `{ type: 'chain_depth_exceeded', max, actual }`
- `{ type: 'invalid_signature', detail }`
- `{ type: 'attenuation_violation', detail }`
- `{ type: 'malformed_token', detail }`

**Example:**
```typescript
const result = verifyDCT(dct, {
  resource: 'arxiv.org/abs/2602.11865',
  namespace: 'web',
  operation: 'search',
  now: new Date().toISOString(),
  spentMicrocents: 0,
  rootPublicKey: issuer.principal.id,
});

if (result.ok) {
  console.log('Remaining budget:', result.value.remainingBudgetMicrocents);
}
```

---

### `inspectDCT(token: SerializedDCT): { ... }`

Inspect a DCT without verifying signatures. Useful for debugging and display.

**Returns:** `{ issuer, delegatee, contractId, delegationId, capabilities, expiresAt, chainDepth, revocationIds }`

**Example:**
```typescript
const info = inspectDCT(dct);
console.log(`Issued by: ${info.issuer}`);
console.log(`Capabilities: ${info.capabilities.length}`);
console.log(`Expires: ${info.expiresAt}`);
```

---

### `getRevocationIds(token: SerializedDCT): string[]`

Get all revocation IDs for a token (one per block: authority + each attenuation).

---

## core/chain

In-memory delegation chain store.

### `MemoryChainStore`

```typescript
class MemoryChainStore implements ChainStore
```

**Methods:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `put` | `(delegation: Delegation) => Promise<void>` | Store a delegation |
| `get` | `(delegationId: string) => Promise<Delegation \| null>` | Retrieve by ID |
| `getChildren` | `(delegationId: string) => Promise<Delegation[]>` | Get child delegations |
| `updateStatus` | `(delegationId: string, status, attestationId?) => Promise<void>` | Update status |
| `getChain` | `(delegationId: string) => Promise<Delegation[]>` | Get full chain to root |
| `verifyChain` | `(delegationId: string) => Promise<{ valid, error? }>` | Verify chain integrity |

**`Delegation` type:**
```typescript
interface Delegation {
  id: string;              // "del_" + 12 hex chars
  parentId: string;        // "del_000000000000" for root
  from: string;            // delegator pubkey
  to: string;              // delegatee pubkey
  contractId: string;
  dct: SerializedDCT;
  depth: number;
  status: 'active' | 'completed' | 'failed' | 'revoked';
  createdAt: string;
  completedAt?: string;
  attestationId?: string;
}
```

**Example:**
```typescript
import { MemoryChainStore, generateDelegationId } from 'delegateos/core/chain';

const store = new MemoryChainStore();

await store.put({
  id: 'del_abc123',
  parentId: 'del_000000000000',
  from: alice.principal.id,
  to: bob.principal.id,
  contractId: 'ct_001',
  dct: rootDCT,
  depth: 0,
  status: 'active',
  createdAt: new Date().toISOString(),
});

await store.updateStatus('del_abc123', 'completed', 'att_xyz789');
```

### `generateDelegationId(): string`

Generate a random delegation ID (`"del_"` + 12 hex chars).

---

## core/contract

Task contracts with creation, signing, and output verification.

### `createContract(issuer, task, verification, constraints): TaskContract`

Create a signed task contract.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `issuer` | `Keypair` | Contract issuer's keypair |
| `task` | `TaskSpec` | Task title, description, inputs, outputSchema |
| `verification` | `VerificationSpec` | How to verify output |
| `constraints` | `TaskConstraints` | Budget, deadline, chain depth, required capabilities |

**`TaskSpec`:**
```typescript
interface TaskSpec {
  title: string;
  description: string;
  inputs: Record<string, unknown>;
  outputSchema: Record<string, unknown>; // JSON Schema draft-07
}
```

**`VerificationSpec`:**
```typescript
interface VerificationSpec {
  method: 'schema_match' | 'deterministic_check' | 'composite';
  schema?: Record<string, unknown>;          // for schema_match
  checkName?: string;                         // for deterministic_check
  checkParams?: unknown;                      // for deterministic_check
  expectedResult?: unknown;                   // for deterministic_check
  steps?: VerificationSpec[];                 // for composite
  mode?: 'all_pass' | 'majority' | 'weighted'; // for composite
  weights?: number[];                         // for weighted mode
  passThreshold?: number;                     // for weighted mode (default 0.7)
}
```

**`TaskConstraints`:**
```typescript
interface TaskConstraints {
  maxBudgetMicrocents: number;
  deadline: string;
  maxChainDepth: number;
  requiredCapabilities: string[]; // "namespace:action" format
}
```

**Example:**
```typescript
import { createContract, verifyOutput, createDefaultRegistry } from 'delegateos/core/contract';

const contract = createContract(
  issuer,
  {
    title: 'Analyze auth code',
    description: 'Find security issues in authentication module',
    inputs: { files: ['src/auth/login.cs'] },
    outputSchema: {
      type: 'object',
      required: ['findings'],
      properties: {
        findings: { type: 'array', items: { type: 'object' } },
      },
    },
  },
  { method: 'schema_match', schema: { /* same schema */ } },
  {
    maxBudgetMicrocents: 500_000,
    deadline: new Date(Date.now() + 3600_000).toISOString(),
    maxChainDepth: 2,
    requiredCapabilities: ['code:analyze'],
  },
);
```

---

### `verifyOutput(contract, output, registry): Result<CheckResult, Error>`

Verify output against a contract's verification spec.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `contract` | `TaskContract` | The contract to verify against |
| `output` | `unknown` | The output to verify |
| `registry` | `CheckFunctionRegistry` | Registry of check functions |

**Returns:** `Result<CheckResult, Error>` where `CheckResult` is `{ passed: boolean, score?: number, details?: string }`.

**Example:**
```typescript
const registry = createDefaultRegistry();
const result = verifyOutput(contract, { findings: [{ severity: 'high', message: 'SQL injection' }] }, registry);

if (result.ok && result.value.passed) {
  console.log('Output verified!');
}
```

---

### `verifyContractSignature(contract, issuerPublicKey): boolean`

Verify a contract's Ed25519 signature.

---

### `CheckFunctionRegistry`

Registry for deterministic check functions.

| Method | Signature | Description |
|--------|-----------|-------------|
| `register` | `(name: string, fn: CheckFunction) => void` | Register a check function |
| `get` | `(name: string) => CheckFunction` | Get by name (throws if not found) |
| `list` | `() => string[]` | List all registered names |

### `createDefaultRegistry(): CheckFunctionRegistry`

Creates a registry pre-loaded with 7 built-in checks:

| Name | Params | Description |
|------|--------|-------------|
| `regex_match` | `{ pattern, flags?, field? }` | Test string against regex |
| `json_schema` | `{ schema }` | Validate against JSON Schema |
| `string_length` | `{ min?, max?, field? }` | Check string length bounds |
| `array_length` | `{ min?, max?, field? }` | Check array length bounds |
| `field_exists` | `{ fields: string[] }` | Check fields exist (dot-path) |
| `exit_code` | `{ expected: number }` | Check process exit code |
| `output_equals` | `{ expected }` | Deep equality check |

---

## core/attestation

Cryptographic attestations for task completion and delegation verification.

### `createCompletionAttestation(signer, contractId, delegationId, result, childAttestations?): Attestation`

Create a signed attestation that a task was completed.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `signer` | `Keypair` | Attesting principal's keypair |
| `contractId` | `string` | Contract this attestation covers |
| `delegationId` | `string` | Delegation this attestation covers |
| `result` | `AttestationResult` | Completion result data |
| `childAttestations` | `string[]` | IDs of child attestations (default `[]`) |

**`AttestationResult`:**
```typescript
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

**Returns:** `Attestation` — Signed attestation with auto-generated ID (`"att_"` + 12 hex chars).

**Example:**
```typescript
import { createCompletionAttestation } from 'delegateos/core/attestation';

const attestation = createCompletionAttestation(
  agentKeypair,
  'ct_review_001',
  'del_abc123',
  {
    success: true,
    output: { findings: [{ severity: 'high', message: 'SQL injection in login.cs' }] },
    costMicrocents: 15000,
    durationMs: 2500,
    verificationOutcome: { method: 'schema_match', passed: true, score: 1.0 },
  },
);
```

---

### `createDelegationVerificationAttestation(signer, contractId, delegationId, result, childAttestations?): Attestation`

Create a signed attestation that a delegation was verified. Same signature as `createCompletionAttestation`, but sets `type: 'delegation_verification'`.

---

### `verifyAttestationSignature(attestation, signerPublicKey): boolean`

Verify an attestation's Ed25519 signature against the expected signer's public key.

**Example:**
```typescript
import { verifyAttestationSignature } from 'delegateos/core/attestation';

const valid = verifyAttestationSignature(attestation, agentKeypair.principal.id);
console.log('Signature valid:', valid); // true
```

---

## core/revocation

In-memory revocation management.

### `InMemoryRevocationList`

```typescript
class InMemoryRevocationList implements RevocationListInterface
```

| Method | Signature | Description |
|--------|-----------|-------------|
| `isRevoked` | `(revocationId: string) => boolean` | Check if an ID is revoked |
| `add` | `(entry: RevocationEntry) => Result<void, string>` | Add entry (verifies signature) |
| `addUnchecked` | `(entry: RevocationEntry) => void` | Add without signature check (testing) |
| `list` | `() => RevocationEntry[]` | List all entries |
| `getRevocationIds` | `() => string[]` | Get all revoked IDs |
| `remove` | `(revocationId: string) => boolean` | Remove a revocation |
| `toJSON` | `() => string` | Serialize |
| `fromJSON` (static) | `(json: string) => InMemoryRevocationList` | Deserialize |

**Example:**
```typescript
import { InMemoryRevocationList, createRevocationEntry } from 'delegateos/core/revocation';

const revocations = new InMemoryRevocationList();
const entry = createRevocationEntry(issuerKeypair, revocationId, 'chain');
revocations.add(entry);

console.log(revocations.isRevoked(revocationId)); // true
```

---

### `createRevocationEntry(signer, revocationId, scope?): RevocationEntry`

Create a signed revocation entry.

| Name | Type | Description |
|------|------|-------------|
| `signer` | `Keypair` | Revoker's keypair (must be the block signer) |
| `revocationId` | `string` | Revocation ID to revoke (from `getRevocationIds`) |
| `scope` | `'block' \| 'chain'` | `'block'` = single block, `'chain'` = cascade (default `'block'`) |

---

### `cascadeRevoke(list, signer, revocationIds): void`

Revoke an entire chain of token blocks. Creates a `'chain'`-scoped revocation entry for each ID and adds it to the list.

**Example:**
```typescript
import { cascadeRevoke, InMemoryRevocationList } from 'delegateos/core/revocation';
import { getRevocationIds } from 'delegateos/core/dct';

const list = new InMemoryRevocationList();
const ids = getRevocationIds(suspiciousToken);
cascadeRevoke(list, issuerKeypair, ids);
```

---

## mcp/plugin

MCP middleware that intercepts `tools/call` and enforces DCT permissions.

### `createMCPPlugin(config: MCPPluginConfig): MCPPlugin`

Create an MCP middleware plugin.

**`MCPPluginConfig`:**

| Field | Type | Description |
|-------|------|-------------|
| `toolCapabilities` | `ToolCapabilityMap` | Maps tool names to capability requirements |
| `trustedRoots` | `string[]` | Public keys of trusted root issuers |
| `revocations` | `RevocationListInterface` | Active revocation list |
| `budgetTracker` | `BudgetTracker` | Tracks spend per delegation |

**`ToolCapabilityMap`:**
```typescript
interface ToolCapabilityMap {
  [toolName: string]: {
    namespace: string;
    action: string;
    resourceExtractor?: (args: Record<string, unknown>) => string;
  };
}
```

**`BudgetTracker`:**
```typescript
interface BudgetTracker {
  getSpent(delegationId: string): number;
  recordSpend(delegationId: string, microcents: number): void;
}
```

**Returns:** Object with:

| Method | Description |
|--------|-------------|
| `handleRequest(req: MCPRequest)` | Intercept and verify. Returns forwarded request or error response. |
| `handleResponse(req, res)` | Record spend after successful tool call. |
| `addRevocation(entry)` | Add a revocation entry to the plugin's list. |
| `getAuditLog()` | Get the audit log instance. |

**Request flow:**
1. Non-`tools/call` → pass through
2. No `_delegateos` metadata → pass through  
3. Has `_delegateos` → deserialize DCT → map tool to capability → verify DCT → strip metadata → forward

**Error response format:**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "error": {
    "code": -32001,
    "message": "DCT verification failed",
    "data": { "type": "capability_not_granted", "..." }
  }
}
```

**Example:**
```typescript
import { createMCPPlugin } from 'delegateos/mcp/plugin';
import { InMemoryRevocationList } from 'delegateos/core/revocation';

const spent = new Map<string, number>();

const plugin = createMCPPlugin({
  toolCapabilities: {
    web_search: { namespace: 'web', action: 'search' },
    read_file: {
      namespace: 'docs',
      action: 'read',
      resourceExtractor: (args) => args.path as string,
    },
  },
  trustedRoots: [orchestrator.principal.id],
  revocations: new InMemoryRevocationList(),
  budgetTracker: {
    getSpent: (id) => spent.get(id) ?? 0,
    recordSpend: (id, mc) => spent.set(id, (spent.get(id) ?? 0) + mc),
  },
});

// In your MCP proxy:
const result = await plugin.handleRequest(incomingRequest);
if ('error' in result) {
  // Send error back to client
} else {
  // Forward to upstream MCP server
  const response = await upstream.send(result);
  await plugin.handleResponse(result, response);
}
```
