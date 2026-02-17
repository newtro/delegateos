# DelegateOS Launch Content

All content ready to copy-paste. No edits needed unless noted.

---

## 1. Show HN Post

**Title:** DelegateOS: Cryptographic delegation tokens for multi-agent systems (DeepMind paper impl)

**Body:**

I built DelegateOS because every agent framework today assumes all agents are trusted. CrewAI, AutoGen, LangGraph, MCP, A2A — none of them answer a basic question: when Agent A delegates to Agent B, what prevents B from accessing things A never intended?

The Google DeepMind delegation paper (arxiv.org/abs/2602.11865, Feb 2026) calls this out explicitly. MCP handles tool access, A2A handles agent communication, but nobody handles the trust and accountability layer between them. DelegateOS fills that gap with Ed25519-signed delegation tokens that enforce monotonic attenuation (sub-agents can only get narrower scope), budget caps across delegation chains, contract-based task verification, and cryptographic attestation chains for auditing.

It's a TypeScript library, MIT licensed, 374 tests passing. Ships with an MCP middleware plugin so you can drop it into existing MCP setups. The token format is inspired by Biscuit/Macaroons but purpose-built for agent delegation. Practical use cases: personal assistant guardrails (your research sub-agent can search the web but never touch your email), automated code review pipelines with per-specialist scoping, multi-tenant agent marketplaces with cryptographic tenant isolation.

https://github.com/newtro/delegateos

---

## 2. Twitter/X Thread

**Tweet 1:**
Every multi-agent framework today runs on the honor system. When your AI assistant delegates a task to a sub-agent, nothing prevents that sub-agent from reading your files, sending emails, or blowing your API budget. We just trust and hope.

**Tweet 2:**
DelegateOS fixes this with Delegation Capability Tokens. Ed25519-signed JSON tokens that encode exactly what an agent can do: which tools, which resources, how much it can spend, when it expires. Cryptographically enforced, not prompt-engineered.

**Tweet 3:**
The key insight is monotonic attenuation. When you delegate downstream, you can only narrow scope. Your research sub-agent gets web search on .edu domains, a $0.50 budget, and a 10-minute window. It physically cannot access your email. Not "shouldn't." Cannot.

**Tweet 4:**
Every completed task produces a signed attestation. Cryptographic proof of what was done, by whom, verified against a contract that specifies what "done" means. Schema validation, deterministic checks, LLM judge, or composite. No ambiguity.

**Tweet 5:**
Use case: personal AI assistant. Your main agent has broad capabilities. It delegates research to a cheaper model. DelegateOS ensures the sub-agent can only search the web, only on certain domains, with a tight budget and short expiry. Revocable mid-flight.

**Tweet 6:**
Use case: agent marketplace. Multiple vendors publish agents as services. DelegateOS provides cryptographic tenant isolation, automatic agent discovery via capability matching, trust scoring from past performance, and budget tracking across the entire chain.

**Tweet 7:**
The Google DeepMind delegation paper (Feb 2026) identified this exact gap. MCP does tool access. A2A does agent communication. Nobody does trust and accountability between delegating agents. That paper is why DelegateOS exists.

**Tweet 8:**
TypeScript, MIT licensed, 374 tests, MCP middleware plugin included. npm install delegate-os.

https://github.com/newtro/delegateos

**Tweet 9:**
If you're building anything with multiple agents and you haven't solved the trust problem yet, take a look. PRs welcome. The hard part isn't the crypto. It's getting the attenuation semantics right for real-world delegation chains.

---

## 3. Substack Article (42 Insights)

**Title:** Don't Panic: Your AI Agents Need Passports

**Subtitle:** Building cryptographic trust boundaries for the agentic web, inspired by a DeepMind paper and 41 years of "who authorized that?"

---

There's a moment in every software architect's career when you realize the system you built assumes everyone is nice. It happened to me in 1987 with a shared file server. It happened again in 2003 with a web app that trusted client-side validation. And it's happening right now, across the entire AI agent ecosystem, at a scale that would make Douglas Adams reach for his towel.

### The Problem: Trust Me, I'm an Agent

Here's the setup. You have an AI assistant. It's helpful. It can search the web, read your documents, send emails, book meetings. You ask it to research a topic, and it delegates that research to a cheaper, faster sub-agent. Reasonable architecture. Every framework supports it.

Now here's the question nobody's asking: what stops that research sub-agent from reading your private files? What stops it from sending an email as you? What stops it from spending $500 on API calls when you expected $0.50?

The answer, in every major agent framework today, is nothing. CrewAI, AutoGen, LangGraph, OpenClaw, whatever you're using. The delegation model is "here's a task, go do it, I trust you." There are no scoped permissions. No budget enforcement. No cryptographic proof that work was completed correctly. No way to revoke a delegation mid-flight.

It's the honor system, applied to autonomous software that hallucinates.

If that doesn't worry you, you haven't been paying attention. And if you have been paying attention, you've probably been waiting for someone to build the solution. I got tired of waiting.

### The DeepMind Paper: Someone Finally Said It

In February 2026, Google DeepMind published a paper (arxiv.org/abs/2602.11865) that laid out the agent infrastructure stack as it exists today. MCP handles tool access. A2A handles agent-to-agent communication. But between these two layers, there's a gap the size of the Ravenous Bugblatter Beast of Traal.

Nobody handles delegation trust. Nobody handles accountability. Nobody handles the question of "Agent B says it completed the task, but did it actually, and can we prove it?"

The paper didn't build a solution. It identified the gap. That was enough for me.

### What We Built

DelegateOS is a TypeScript library that adds cryptographic delegation to multi-agent systems. The core concept is the Delegation Capability Token, or DCT. It's an Ed25519-signed JSON token that encodes everything about what an agent is authorized to do:

- **Capabilities:** Which namespaces, actions, and resources. "Web search on *.edu domains" is a valid scope.
- **Budget:** Maximum spend in microcents. Enforced at every verification checkpoint.
- **Expiry:** When the token dies. No renewals.
- **Chain depth:** How many levels of sub-delegation are allowed.
- **Contract reference:** What task this delegation is for, and what "done" means.

The critical property is **monotonic attenuation**. When Agent A delegates to Agent B, B's token can only be equal to or narrower than A's token. B can then delegate to C, but C's scope can only shrink further. Capabilities never expand as you go down the chain. This isn't a policy. It's math. The verification algorithm rejects any token that attempts to widen scope.

### How It Works

Let's walk through the personal assistant use case. You're the root authority. Your assistant gets broad capabilities. It delegates research to a sub-agent with narrow scope.

```typescript
import { generateKeypair, createDCT, attenuateDCT, verifyDCT } from 'delegate-os';

// Everyone gets an Ed25519 keypair
const you = generateKeypair();
const assistant = generateKeypair();
const researcher = generateKeypair();

// You grant your assistant broad capabilities
const assistantToken = createDCT({
  issuer: you,
  delegatee: assistant.principal,
  capabilities: [
    { namespace: 'web', action: 'search', resource: '*' },
    { namespace: 'docs', action: 'read', resource: '/home/me/**' },
    { namespace: 'email', action: 'send', resource: '*' },
  ],
  contractId: 'ct_daily',
  delegationId: 'del_001',
  parentDelegationId: 'root',
  chainDepth: 0,
  maxChainDepth: 2,
  maxBudgetMicrocents: 1_000_000, // $10
  expiresAt: new Date(Date.now() + 86400_000).toISOString(),
});

// Assistant delegates research — ONLY web search, ONLY .edu, $0.50, 10 minutes
const researchToken = attenuateDCT({
  token: assistantToken,
  attenuator: assistant,
  delegatee: researcher.principal,
  delegationId: 'del_002',
  contractId: 'ct_daily',
  allowedCapabilities: [
    { namespace: 'web', action: 'search', resource: '*.edu/**' },
  ],
  maxBudgetMicrocents: 50_000,
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
});
```

When the researcher tries to use a tool, DelegateOS verifies the token. Web search on arxiv.org? Allowed. Read a file? Denied. The capability was never delegated. Send an email? Denied. Spend more than $0.50? Denied. Try after 10 minutes? Denied, expired.

This isn't access control in the traditional sense. There's no central authority maintaining a permissions database. The token itself carries the proof. Any verifier with the root public key can independently confirm that this token grants these capabilities and no more.

### The Rest of the Stack

Tokens alone aren't enough. DelegateOS also includes:

**Contracts.** Every delegation references a task contract that specifies what "done" means. The contract includes a JSON Schema for the expected output, verification method (schema match, deterministic check, LLM judge, human review, or composite), and constraints like budget and deadline.

**Attestations.** When an agent completes a task, it produces a signed attestation. This is cryptographic proof of completion: what was done, by whom, at what cost, verified against the contract. Attestations chain back to the root delegator, forming an auditable trail.

**Revocation.** You can revoke any delegation mid-flight. Single token or cascading (revoke a token and everything delegated from it). The revocation list is checked at every verification.

**Trust scoring.** Agents build reputation over time. The trust engine tracks reliability, quality, and speed with exponential decay. Cold-start agents get a neutral score. Good performance rises. Bad performance falls. The delegation broker uses trust scores to select agents.

**MCP middleware.** DelegateOS ships a plugin that intercepts MCP `tools/call` requests and enforces DCT permissions transparently. Drop it into an existing MCP setup, define which tools map to which capability namespaces, and every tool call gets verified against the caller's token.

### What's Next

DelegateOS is at v0.3 with 374 tests across 27 files. The core is solid. What's coming:

- **Biscuit token backend** as an opt-in upgrade from the current SJT format. The Datalog engine is already built.
- **Distributed revocation** with gossip-style sync between nodes.
- **HTTP+SSE transport** for running the MCP middleware as a standalone service.
- **Real LLM judge and human review adapters** (currently mocked for testing).

The repository is at github.com/newtro/delegateos. MIT licensed. TypeScript all the way down. npm install delegate-os.

If you're building multi-agent systems and you haven't solved the trust problem yet, you're building on sand. Don't panic. But do bring a towel.

---

## 4. Dev.to Article

**Title:** How to add trust boundaries to your multi-agent system

**Tags:** typescript, ai, security, opensource

---

You have a personal AI assistant that can search the web, read documents, and send emails. It delegates research tasks to a cheaper sub-agent. How do you prevent that sub-agent from sending emails as you?

If your answer involves prompt engineering or "it just wouldn't do that," this tutorial is for you.

### The problem

Multi-agent frameworks like CrewAI, AutoGen, and LangGraph handle orchestration well. MCP handles tool access. But none of them answer the delegation trust question: when Agent A hands a task to Agent B, what limits B's authority?

DelegateOS solves this with cryptographic delegation tokens. Let's build it step by step.

### Setup

```bash
npm install delegate-os
```

```typescript
import {
  generateKeypair,
  createDCT,
  attenuateDCT,
  verifyDCT,
  createMCPPlugin,
  InMemoryRevocationList,
} from 'delegate-os';
```

### Step 1: Create identities

Every participant gets an Ed25519 keypair. This is their identity in the delegation system.

```typescript
const you = generateKeypair();        // Root authority (you)
const assistant = generateKeypair();   // Your main AI assistant
const researcher = generateKeypair();  // Cheap research sub-agent
```

### Step 2: Grant capabilities to your assistant

You create a root Delegation Capability Token (DCT) for your assistant. This token defines exactly what it can do.

```typescript
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
```

Your assistant can search the web, read your docs, and send emails. With a $10 budget and 24-hour expiry.

### Step 3: Delegate research with narrower scope

Here's where it gets interesting. Your assistant delegates to a research sub-agent, but attenuates the token. The sub-agent gets strictly less authority.

```typescript
const researchToken = attenuateDCT({
  token: assistantToken,
  attenuator: assistant,
  delegatee: researcher.principal,
  delegationId: 'del_002',
  contractId: 'ct_daily_tasks',
  allowedCapabilities: [
    { namespace: 'web', action: 'search', resource: '*.edu/**' },
  ],
  maxBudgetMicrocents: 50_000,    // $0.50
  expiresAt: new Date(Date.now() + 600_000).toISOString(), // 10 minutes
});
```

The researcher can only search .edu domains. No docs access. No email. $0.50 budget. 10-minute window. These aren't suggestions. They're cryptographically enforced.

### Step 4: Verify at the point of use

When the researcher tries to use a tool, verify the token:

```typescript
// Allowed: web search on an .edu domain
const allowed = verifyDCT(researchToken, {
  resource: 'arxiv.org/search',
  namespace: 'web',
  operation: 'search',
  now: new Date().toISOString(),
  spentMicrocents: 0,
  rootPublicKey: you.principal.id,
  revocationIds: [],
});
console.log(allowed.ok); // true

// Denied: email was never delegated
const denied = verifyDCT(researchToken, {
  resource: 'boss@company.com',
  namespace: 'email',
  operation: 'send',
  now: new Date().toISOString(),
  spentMicrocents: 0,
  rootPublicKey: you.principal.id,
  revocationIds: [],
});
console.log(denied.ok); // false
```

### Step 5: Add MCP middleware

If you're using MCP, DelegateOS drops in as middleware:

```typescript
const plugin = createMCPPlugin({
  toolCapabilities: {
    web_search: { namespace: 'web', action: 'search' },
    read_file: {
      namespace: 'docs',
      action: 'read',
      resourceExtractor: (args) => args.path as string,
    },
    send_email: { namespace: 'email', action: 'send' },
  },
  trustedRoots: [you.principal.id],
  revocations: new InMemoryRevocationList(),
  budgetTracker: { getSpent: () => 0, recordSpend: () => {} },
});

// Every tools/call request gets checked against the caller's DCT
const result = await plugin.handleRequest(mcpRequest);
```

The plugin also filters `tools/list` responses. The researcher would only see `web_search` in its available tools. `read_file` and `send_email` don't exist from its perspective.

### Step 6: Revoke if needed

Something going wrong? Revoke the delegation instantly:

```typescript
const revocationList = new InMemoryRevocationList();
revocationList.revoke('del_002'); // Single delegation
// or
revocationList.revokeCascade('del_001'); // Revoke assistant + all downstream
```

All subsequent verification checks will reject the revoked tokens.

### What you get

- Sub-agents with cryptographically scoped authority
- Budget enforcement across delegation chains
- Time-limited delegations with automatic expiry
- Mid-flight revocation
- MCP integration with zero changes to your existing tools

The full source, docs, and a PR review demo are at [github.com/newtro/delegateos](https://github.com/newtro/delegateos). MIT licensed, 374 tests passing.

---

## 5. Reddit Posts

### r/LocalLLaMA

**Title:** Built a cryptographic delegation layer for multi-agent setups — agents get scoped tokens instead of full access

**Body:**

I've been running local agents that delegate to each other and kept hitting the same problem: there's no way to limit what a sub-agent can do. If my main assistant delegates research to a smaller model, that smaller model has the same tool access as my main agent. No scoping. No budget limits.

So I built DelegateOS. It's a TypeScript library that creates Ed25519-signed delegation tokens. When you delegate to a sub-agent, you create a token that says exactly what it can do (which tools, which resources), how much it can spend, and when the token expires. The sub-agent can delegate further, but only with equal or narrower scope. Monotonic attenuation, enforced by the crypto, not by prompts.

Everything runs locally. No external services. The crypto is standard Ed25519. Token verification needs only the root public key. There's an MCP middleware plugin if you're using MCP for tool access.

374 tests, MIT licensed. https://github.com/newtro/delegateos

Curious if anyone else has been thinking about this problem. The DeepMind delegation paper (Feb 2026) identified it as a major gap in the current agent infra stack.

---

### r/node

**Title:** delegateos — TypeScript library for scoped delegation between AI agents (Ed25519 tokens, MCP middleware, npm package)

**Body:**

Just shipped v0.3 of DelegateOS, a TypeScript library for adding cryptographic trust boundaries to multi-agent systems.

**What it does:** Creates Ed25519-signed delegation tokens that scope what an agent can do (capabilities, budget, expiry, chain depth). Tokens attenuate monotonically, meaning sub-agents can only get narrower scope. Ships with an MCP middleware plugin for transparent enforcement on `tools/call` requests.

**Tech details:**
- Pure TypeScript, no native dependencies for core crypto (uses Node's built-in crypto)
- MCP plugin intercepts requests, verifies tokens, filters tool lists
- In-memory and SQLite storage adapters
- Rate limiting, circuit breaker, structured logging built in
- 374 tests across 27 files, 0 TypeScript errors

```bash
npm install delegate-os
```

```typescript
import { generateKeypair, createDCT, attenuateDCT, verifyDCT } from 'delegate-os';
```

The API is functional-style: create a token, attenuate it for a sub-agent, verify at point of use. No classes to instantiate for the core flow.

Repo: https://github.com/newtro/delegateos

Happy to answer questions about the token format, the attenuation algorithm, or the MCP integration.

---

### r/MachineLearning

**Title:** [P] Open-source implementation of the delegation trust layer identified in the DeepMind multi-agent infrastructure paper

**Body:**

The recent Google DeepMind paper on agentic infrastructure (arxiv.org/abs/2602.11865, Feb 2026) maps out the current stack: MCP for tool access, A2A for agent communication. The paper identifies a critical missing layer: delegation trust and accountability between agents.

When Agent A delegates to Agent B, current frameworks provide no mechanism for scoping B's authority, enforcing budget constraints across delegation chains, verifying task completion against contracts, or revoking delegations mid-flight.

I built DelegateOS to fill this gap. It implements:

- **Delegation Capability Tokens (DCTs):** Ed25519-signed tokens encoding capabilities, budgets, expiry, and chain depth. Inspired by Biscuit tokens/Macaroons but purpose-built for agent delegation.
- **Monotonic attenuation:** Sub-delegations can only narrow scope, never widen it. Formally: for any capability c in child token T', c must be a subset of some capability in parent token T.
- **Contract-based verification:** Tasks have contracts specifying output schema and verification method (schema match, deterministic check, LLM judge, human review, or composite).
- **Attestation chains:** Cryptographic proof of task completion, forming an auditable chain from leaf agent to root delegator.
- **Trust scoring:** Composite trust scores (reliability, quality, speed) with exponential decay and cold-start handling.

The trust engine and agent registry together support automated agent selection for delegation based on capability matching, trust scores, and cost.

TypeScript implementation, 374 tests, MIT licensed: https://github.com/newtro/delegateos

Interested in feedback from anyone working on agent safety, capability-based security, or multi-agent coordination. The token attenuation semantics were the hardest part to get right for real-world delegation patterns.

---

## 6. Discord Messages

### OpenClaw Discord

Hey all. I built a library that adds cryptographic delegation tokens to MCP. It ships an MCP middleware plugin that intercepts `tools/call` requests and enforces scoped permissions via Ed25519-signed tokens. Each agent gets a token defining what tools it can use, what resources it can access, and how much it can spend. The plugin also filters `tools/list` so agents only see tools they're authorized for.

Drop-in integration: define a mapping from tool names to capability namespaces, point it at your trusted root keys, and every request gets verified.

TypeScript, MIT, 374 tests: https://github.com/newtro/delegateos

---

### CrewAI Discord

Been working on the delegation trust problem. When your crew delegates tasks between agents, there's no mechanism to scope what a sub-agent can actually do. DelegateOS adds cryptographic delegation tokens: Agent A creates a scoped token for Agent B, B can delegate to C with equal or narrower scope. Budgets, expiry, capabilities all enforced by Ed25519 signatures. Each completed task produces a signed attestation. Trust scores build over time so reliable agents get delegated to first.

It's framework-agnostic TypeScript, so it could sit alongside CrewAI's delegation system. https://github.com/newtro/delegateos

---

### General AI Discord

Question for the group: how are you handling trust between agents in multi-agent setups? Not tool access (MCP covers that) but delegation trust. When your orchestrator hands a task to a sub-agent, what limits the sub-agent's authority?

I got frustrated with the answer being "nothing" and built DelegateOS. Ed25519-signed delegation tokens with monotonic attenuation: sub-agents can only get narrower scope than their parent. Budgets, expiry, revocation, contract-based verification, attestation chains.

The DeepMind delegation paper (Feb 2026) identified this as the missing layer. This is an open-source implementation of that layer. https://github.com/newtro/delegateos
