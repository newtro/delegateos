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

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full architecture document, including token format, verification algorithms, security model, and package structure.

See [docs/protocol-spec.md](docs/protocol-spec.md) for the wire-level protocol specification.

## v0.1 Scope

### Included
- **DCT Engine** — Create, attenuate, verify Ed25519-signed JSON tokens
- **Contract System** — Task contracts with schema, deterministic, and composite verification
- **Attestation Engine** — Signed completion and delegation verification attestations
- **Revocation** — In-memory revocation list with cascade support
- **Delegation Chain Store** — In-memory chain tracking with integrity verification
- **MCP Middleware** — `tools/call` interception, DCT enforcement, audit logging
- **Demo** — Full PR review delegation scenario

### Coming in v0.2
- Trust/reputation scoring engine
- A2A protocol integration (Agent Card extensions)
- Contract decomposition engine (recursive task splitting)
- Biscuit token backend (upgrade from signed JSON)
- Persistent storage (SQLite/Postgres)
- `llm_judge` and `human_review` verification methods
- HTTP+SSE MCP proxy transport
- Distributed revocation

## License

MIT
