# Getting Started with DelegateOS

A step-by-step tutorial from zero to a working delegation chain.

## 1. Installation

```bash
npm install delegateos
```

Or clone and build from source:

```bash
git clone https://github.com/newtro/delegateos.git
cd delegateos
npm install
npm run build
```

## 2. Create an Identity

Every principal in DelegateOS is identified by an Ed25519 keypair. The public key (base64url-encoded) is your identity.

```typescript
import { generateKeypair } from 'delegateos/core/crypto';

const alice = generateKeypair();
console.log('Principal ID:', alice.principal.id);
// → "kT9Xv3m2..." (43-char base64url public key)

// The keypair contains:
// - alice.principal.id    — public key (share this)
// - alice.privateKey      — 32-byte Ed25519 seed (keep secret)
```

## 3. Create Your First DCT

A DCT (Delegation Capability Token) encodes what an agent is allowed to do: which capabilities, how much budget, how long, and how deep the delegation chain can go.

```typescript
import { createDCT } from 'delegateos/core/dct';

const alice = generateKeypair(); // root authority
const bob = generateKeypair();   // delegatee

const dct = createDCT({
  issuer: alice,
  delegatee: bob.principal,
  capabilities: [
    { namespace: 'web', action: 'search', resource: '*' },
    { namespace: 'code', action: 'analyze', resource: 'src/**' },
  ],
  contractId: 'ct_my_first_task',
  delegationId: 'del_001',
  parentDelegationId: 'del_000000000000', // root — no parent
  chainDepth: 0,
  maxChainDepth: 3,                       // can delegate 3 levels deep
  maxBudgetMicrocents: 500_000,           // $5.00
  expiresAt: new Date(Date.now() + 3600_000).toISOString(), // 1 hour
});

console.log('Token format:', dct.format);  // "delegateos-sjt-v1"
console.log('Token length:', dct.token.length, 'chars');
```

## 4. Attenuate for a Sub-Agent

Bob wants to delegate a narrower piece of work to Carol. He can only restrict scope — never expand it.

```typescript
import { attenuateDCT } from 'delegateos/core/dct';

const carol = generateKeypair();

const narrowDCT = attenuateDCT({
  token: dct,                        // Bob's token from Alice
  attenuator: bob,                   // Bob must be the current delegatee
  delegatee: carol.principal,        // Carol gets the narrowed token
  delegationId: 'del_002',
  contractId: 'ct_my_first_task',

  // Narrow the scope:
  allowedCapabilities: [
    { namespace: 'code', action: 'analyze', resource: 'src/auth/**' },
  ],
  maxBudgetMicrocents: 100_000,      // $1.00 (was $5.00)
  maxChainDepth: 1,                  // Carol can't delegate further than 1 more level
});
```

What happens if Bob tries to expand scope?

```typescript
// This THROWS — capability expansion not allowed
attenuateDCT({
  token: dct,
  attenuator: bob,
  delegatee: carol.principal,
  delegationId: 'del_003',
  contractId: 'ct_my_first_task',
  allowedCapabilities: [
    { namespace: 'database', action: 'write', resource: '*' }, // ❌ not in parent
  ],
});
```

## 5. Verify a Token

Verification checks everything: signatures, attenuation chain, revocations, expiry, budget, and capability match.

```typescript
import { verifyDCT } from 'delegateos/core/dct';

const result = verifyDCT(narrowDCT, {
  resource: 'src/auth/login.cs',       // what Carol wants to access
  namespace: 'code',
  operation: 'analyze',
  now: new Date().toISOString(),
  spentMicrocents: 0,                  // nothing spent yet
  rootPublicKey: alice.principal.id,    // Alice is the trusted root
  revocationIds: [],                   // no revocations
});

if (result.ok) {
  console.log('✅ Authorized');
  console.log('Capabilities:', result.value.capabilities);
  console.log('Budget remaining:', result.value.remainingBudgetMicrocents);
  console.log('Chain depth:', result.value.chainDepth);
} else {
  console.log('❌ Denied:', result.error.type);
}
```

Try accessing something outside Carol's scope:

```typescript
const denied = verifyDCT(narrowDCT, {
  resource: 'src/data/UserRepo.cs',    // outside src/auth/**
  namespace: 'code',
  operation: 'analyze',
  now: new Date().toISOString(),
  spentMicrocents: 0,
  rootPublicKey: alice.principal.id,
});

console.log(denied.ok);        // false
console.log(denied.error.type); // "capability_not_granted"
```

## 6. Create a Task Contract with Verification

Contracts define what "done" means. The verification spec determines how output is checked.

```typescript
import { createContract, verifyOutput, createDefaultRegistry } from 'delegateos/core/contract';

const outputSchema = {
  type: 'object',
  required: ['findings', 'summary'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'message', 'file'],
        properties: {
          severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
          message: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
        },
      },
    },
    summary: { type: 'string' },
  },
};

const contract = createContract(
  alice,
  {
    title: 'Security review of auth module',
    description: 'Find security vulnerabilities in authentication code',
    inputs: { files: ['src/auth/login.cs', 'src/auth/token.cs'] },
    outputSchema,
  },
  {
    method: 'composite',
    mode: 'all_pass',
    steps: [
      { method: 'schema_match', schema: outputSchema },
      {
        method: 'deterministic_check',
        checkName: 'array_length',
        checkParams: { min: 1, field: 'findings' },
      },
    ],
  },
  {
    maxBudgetMicrocents: 500_000,
    deadline: new Date(Date.now() + 3600_000).toISOString(),
    maxChainDepth: 2,
    requiredCapabilities: ['code:analyze'],
  },
);

// Verify output against the contract
const registry = createDefaultRegistry();

const output = {
  findings: [
    { severity: 'critical', message: 'SQL injection in login query', file: 'src/auth/login.cs', line: 42 },
    { severity: 'warning', message: 'Token expiry not checked', file: 'src/auth/token.cs', line: 15 },
  ],
  summary: 'Found 1 critical and 1 warning issue in auth module',
};

const verifyResult = verifyOutput(contract, output, registry);
if (verifyResult.ok && verifyResult.value.passed) {
  console.log('✅ Output verified! Score:', verifyResult.value.score);
}
```

You can register custom check functions:

```typescript
registry.register('has_critical_finding', (output: unknown) => {
  const o = output as { findings: Array<{ severity: string }> };
  const hasCritical = o.findings?.some(f => f.severity === 'critical');
  return { passed: hasCritical, score: hasCritical ? 1 : 0 };
});
```

## 7. Create Attestations

After completing work, agents create signed attestations as proof.

```typescript
import { createCompletionAttestation, verifyAttestationSignature } from 'delegateos/core/attestation';

const attestation = createCompletionAttestation(
  bob,                      // signer
  contract.id,              // contract ID
  'del_001',                // delegation ID
  {
    success: true,
    output,                 // the verified output
    costMicrocents: 15000,
    durationMs: 2500,
    verificationOutcome: {
      method: 'composite',
      passed: true,
      score: 1.0,
    },
  },
  [],                       // child attestation IDs (if any)
);

console.log('Attestation ID:', attestation.id);    // "att_a1b2c3d4e5f6"
console.log('Type:', attestation.type);             // "completion"

// Verify the attestation signature
const valid = verifyAttestationSignature(attestation, bob.principal.id);
console.log('Signature valid:', valid);             // true
```

## 8. Run the Demo Scenario

The included demo simulates a full PR review with an orchestrator delegating to 3 specialist agents:

```bash
npx tsx src/demo/scenario.ts
```

This runs 4 demos:
1. **Full PR review** — Orchestrator creates contracts, delegates to security/Blazor/database specialists, collects attestations
2. **Token attenuation enforcement** — Shows scope narrowing being enforced (auth files ✅, data files ❌)
3. **Mid-flow revocation** — Database specialist gets revoked during review
4. **Expired token rejection** — Token created with past expiry is rejected

## 9. Integrate with MCP

Add DelegateOS as middleware in front of any MCP server to enforce delegation permissions on tool calls.

```typescript
import { createMCPPlugin } from 'delegateos/mcp/plugin';
import { InMemoryRevocationList } from 'delegateos/core/revocation';

// Track spend per delegation
const spent = new Map<string, number>();

const plugin = createMCPPlugin({
  // Map MCP tool names to capability requirements
  toolCapabilities: {
    web_search: { namespace: 'web', action: 'search' },
    read_file: {
      namespace: 'docs',
      action: 'read',
      resourceExtractor: (args) => args.path as string,
    },
    execute_code: { namespace: 'code', action: 'execute' },
  },

  // Only tokens issued by these keys are accepted
  trustedRoots: [orchestratorKeypair.principal.id],

  revocations: new InMemoryRevocationList(),

  budgetTracker: {
    getSpent: (id) => spent.get(id) ?? 0,
    recordSpend: (id, mc) => spent.set(id, (spent.get(id) ?? 0) + mc),
  },
});

// In your MCP proxy handler:
async function handleMCPRequest(request) {
  const result = await plugin.handleRequest(request);

  // Error — send back to client
  if ('error' in result) return result;

  // Authorized — forward to upstream (metadata stripped)
  const response = await upstreamServer.handle(result);

  // Record spend
  await plugin.handleResponse(result, response);

  return response;
}
```

Agents include DCT metadata in their `tools/call` requests:

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": 1,
  "params": {
    "name": "web_search",
    "arguments": { "query": "OWASP top 10 2025" },
    "_delegateos": {
      "dct": "<base64url token>",
      "format": "delegateos-sjt-v1",
      "delegationId": "del_abc123",
      "contractId": "ct_review_001"
    }
  }
}
```

The plugin verifies the DCT, checks the tool maps to a granted capability, strips `_delegateos`, and forwards the clean request upstream. If verification fails, it returns a JSON-RPC error with code `-32001` and the denial reason.

---

## Next Steps

- Read the [API Reference](api-reference.md) for complete function signatures
- Read the [Architecture](architecture.md) for token format details and security model
- Read the [Protocol Spec](protocol-spec.md) for verification algorithms and wire formats
