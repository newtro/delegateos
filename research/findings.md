# DelegateOS Research Findings

**Date:** 2026-02-17  
**Purpose:** Foundation research for DelegateOS architecture design

---

## 1. Delegation Capability Token (DCT) Implementations

### 1.1 Macaroons (Google, 2014)

**Paper:** [Macaroons: Cookies with Contextual Caveats for Decentralized Authorization in the Cloud](https://theory.stanford.edu/~ataly/Papers/macaroons.pdf)  
**Origin:** Google Research, 2014

**How They Work:**
- Bearer credentials based on chained HMAC signatures
- A root key is known only to the issuing service
- The initial macaroon is created by computing `HMAC(root_key, identifier)`
- Each subsequent caveat appends a new condition and chains the HMAC: `new_sig = HMAC(old_sig, caveat_predicate)`

**Caveats System:**
- **First-party caveats:** Simple predicate conditions verified by the target service (e.g., `account = 12345`, `time < 2026-03-01`)
- **Third-party caveats:** Require a discharge macaroon from an external service (e.g., "user authenticated via IdP X"). The third party issues a discharge macaroon that must be presented alongside the original.
- Caveats are **monotonically restrictive** — you can only add restrictions, never remove them

**Attenuation:**
```
# Conceptual flow
root_macaroon = HMAC(root_key, "identifier")
attenuated = add_first_party_caveat(root_macaroon, "action = read")
further_attenuated = add_first_party_caveat(attenuated, "resource = /docs/project-x")
# Anyone holding further_attenuated can ONLY read /docs/project-x
```

**Real-world Usage:**
- Lightning Network (LND) uses macaroons for API auth with baked/admin/readonly tiers
- Google internal services (origin of the concept)
- Some OAuth2 servers wrap tokens as macaroons for attenuation

**Limitations:**
- Caveat predicates are opaque strings — no standard language for expressing complex policies
- No built-in revocation (bearer token problem)
- No public-key cryptography — relies on shared secrets (HMAC)
- Third-party caveats are clunky in practice

### 1.2 Biscuit (Clever Cloud / Eclipse Foundation)

**Repo:** https://github.com/eclipse-biscuit/biscuit  
**Spec:** https://www.biscuitsec.org  
**Version:** 3.x (current stable)

**Key Innovation: Datalog-based Authorization**

Biscuit replaces macaroons' opaque string caveats with a subset of Datalog, a logic programming language. This enables:
- Complex authorization policies expressible as logical rules
- Role-based access control (RBAC), attribute-based access control (ABAC), and capability-based models
- Policies can be carried by the token OR provided by the verifying service

**Architecture:**
- **Authority block:** Created by token issuer, contains facts and rules (signed with Ed25519 private key)
- **Attenuation blocks:** Added by holders, can only add checks (restrictions), never expand authority
- **Verifier:** Loads token blocks + its own policies, runs Datalog engine to evaluate

**Example Biscuit Token:**
```datalog
// Authority block (issuer)
right("file1", "read");
right("file2", "read");
right("file2", "write");

// Attenuation block (added by holder before delegation)
check if resource($r), operation("read");  // restrict to read-only

// Verifier policy (service-side)
allow if right($resource, $operation);
deny if true;
```

**Improvements over Macaroons:**
| Feature | Macaroons | Biscuit |
|---------|-----------|---------|
| Cryptography | HMAC (shared secret) | Ed25519 (public key) |
| Caveat language | Opaque strings | Datalog subset |
| Offline verification | ❌ (need root key) | ✅ (public key only) |
| Third-party blocks | Clunky | Native support (v3.2+) |
| Revocation | None built-in | Revocation IDs |
| Expressiveness | Simple predicates | Full logic rules |

**Implementations:** Rust (primary), WASM, Python, Haskell, Java, Go, .NET

### 1.3 UCAN (User Controlled Authorization Network)

**Spec:** https://github.com/ucan-wg/spec  
**Origin:** Fission (now part of broader UCAN Working Group)

**How It Works:**
- Extends JWT structure with capability delegation semantics
- Principals identified by DIDs (Decentralized Identifiers)
- Self-signed tokens forming a DAG (directed acyclic graph) of delegations
- No central authority needed — fully decentralized verification

**Key Concepts:**
- **Issuer (iss):** DID of the token creator
- **Audience (aud):** DID of the recipient
- **Capabilities (att):** Array of `{with: resource_URI, can: action_namespace}`
- **Proofs (prf):** CIDs pointing to parent UCANs that authorize this delegation
- **Expiration/Not-before:** Time bounds

**Delegation Chain:**
```
Alice (root authority)
  → UCAN₁ {iss: alice, aud: bob, att: [{with: "dns:example.com/*", can: "crud/update"}]}
    → UCAN₂ {iss: bob, aud: carol, att: [{with: "dns:example.com/blog", can: "crud/update"}], prf: [CID(UCAN₁)]}
```

Each delegation can only narrow scope (attenuation). Carol can update `example.com/blog` but not `example.com/api`.

**Revocation:** Via UCAN Revocation spec — issuers publish revocation lists; verifiers check against them.

**Real-world Usage:**
- WNFS (WebNative File System) — file system permissions in IPFS
- Storacha (formerly web3.storage) — storage permissions
- Bluesky's AT Protocol explored UCAN-like patterns

### 1.4 Comparison for Agent-to-Agent Delegation

| Criteria | Macaroons | Biscuit | UCAN |
|----------|-----------|---------|------|
| **Decentralized verification** | ❌ | ✅ | ✅ |
| **Policy expressiveness** | Low | High (Datalog) | Medium (URI + action) |
| **Delegation chains** | Via 3rd-party caveats | Native blocks | Native proof chains |
| **Identity model** | None (bearer) | Optional | DID-based (required) |
| **Revocation** | None | Revocation IDs | Revocation lists |
| **Maturity** | High (10+ years) | Medium (4+ years) | Medium (3+ years) |
| **Agent suitability** | Poor | **Best** | Good |

**Recommendation for DelegateOS:** **Biscuit** is the strongest candidate for DCTs:
1. Datalog policies can express complex delegation constraints (time bounds, resource scopes, operation limits, spending caps, chain depth limits)
2. Public-key crypto enables offline verification — critical for distributed agent networks
3. Third-party blocks (v3.2) allow multi-party authorization (e.g., human approves + agent verifies capability)
4. Attenuation blocks map perfectly to delegation chain narrowing

**UCAN** is a strong secondary option if DID-based identity is a hard requirement. Consider a **hybrid**: Biscuit's Datalog engine for policy evaluation, UCAN's DID identity model for agent addressing.

---

## 2. Google DeepMind Delegation Framework (Feb 2026)

**Paper:** [Intelligent AI Delegation](https://arxiv.org/abs/2602.11865) (arXiv:2602.11865)  
**Authors:** Google DeepMind (corresponding: nenadt@google.com)  
**Published:** 2026-02-12

### 2.1 Core Definition

> "Intelligent delegation is a sequence of decisions involving task allocation, that also incorporates transfer of authority, responsibility, accountability, clear specifications regarding roles and boundaries, clarity of intent, and mechanisms for establishing trust between the two (or more) parties."

This is NOT just task decomposition. The paper explicitly distinguishes delegation from simple outsourcing/parallelization.

### 2.2 The 5 Pillars

| Pillar | Technical Implementation | Function |
|--------|------------------------|----------|
| **Dynamic Assessment** | Task Decomposition & Assignment | Granularly inferring agent state and capacity |
| **Adaptive Execution** | Adaptive Coordination | Handling context shifts and runtime failures |
| **Structural Transparency** | Monitoring & Verifiable Completion | Auditing both process and outcome |
| **Scalable Market** | Trust, Reputation & Multi-objective Optimization | Efficient, trusted coordination in open markets |
| **Systemic Resilience** | Security & Permission Handling | Preventing cascading failures and malicious use |

### 2.3 Contract-First Decomposition

The paper's most significant architectural contribution:

1. A delegator **only assigns a task if the outcome can be precisely verified**
2. If a task is too subjective or complex to verify (e.g., "write a compelling paper"), the system **recursively decomposes** it
3. Decomposition continues **until sub-tasks match available verification tools** (unit tests, formal proofs, deterministic checks)
4. This creates a hierarchy where every leaf node has a computable verification function

This directly maps to a DCT design where each token encodes:
- The task specification
- The verification method
- The authority scope
- The accountability chain

### 2.4 Transitive Accountability Model

In a chain A → B → C:
- **B is responsible** for verifying C's work
- When B returns results to A, it must provide **cryptographically signed attestations** for the full chain
- A performs a **2-stage check**: (1) verify B's direct work, (2) verify that B correctly verified C
- This is recursive — scales to arbitrary depth

### 2.5 Task Characteristics Taxonomy

The paper defines 11 axes for characterizing tasks:
1. **Complexity** — sub-steps and reasoning sophistication
2. **Criticality** — severity of failure consequences
3. **Uncertainty** — ambiguity in environment/inputs
4. **Duration** — instantaneous to weeks
5. **Cost** — tokens, API fees, energy
6. **Resource Requirements** — tools, data access, compute
7. **Constraints** — operational, ethical, legal boundaries
8. **Verifiability** — difficulty of validating outcomes
9. **Reversibility** — can effects be undone?
10. **Contextuality** — how much external state is needed
11. **Subjectivity** — preference vs. objective fact

**Key insight for DelegateOS:** Tasks with high verifiability + high reversibility can be delegated with minimal oversight. Tasks with low verifiability + low reversibility need maximum human-in-the-loop and strict authority boundaries.

### 2.6 Delegation Capability Tokens (DCTs)

The paper explicitly recommends DCTs based on **Macaroons or Biscuits** with cryptographic caveats enforcing least privilege. Example: an agent receives a token allowing READ on a specific Google Drive folder but forbidding WRITE.

### 2.7 Security Threats Identified

- **Data exfiltration** through delegation chains
- **Backdoor implanting** via compromised delegatees
- **Model extraction** attacks
- **Confused deputy problem** — agent uses legitimate authority for unintended purposes
- **Zone of indifference** — agents blindly following instructions without contextual scrutiny

### 2.8 What They Say About MCP/A2A/AP2/UCP Gaps

| Protocol | What It Does | Gap for Delegation |
|----------|-------------|-------------------|
| **MCP** | Standardizes model-to-tool connections | No policy layer for permissions across deep delegation chains |
| **A2A** | Discovery + task lifecycle | No standardized headers for ZKPs or digital signature chains |
| **AP2** | Authorizes agent spending | Cannot natively verify work quality before releasing payment |
| **UCP** | Standardizes commerce transactions | Optimized for shopping/fulfillment, not abstract computational tasks |

**The paper explicitly calls out the need for a delegation protocol layer that sits BETWEEN these protocols.** This is exactly where DelegateOS would fit.

### 2.9 Other Key Concepts

- **Authority Gradient:** Borrowed from aviation — capability disparities impede communication. Sycophantic agents won't challenge bad delegations.
- **Zone of Indifference:** Range of instructions executed without scrutiny. Current AI safety filters create a static compliance zone that doesn't adapt to context.
- **Span of Control:** How many agents can one orchestrator effectively manage? Goal-dependent and domain-dependent.
- **Transaction Cost Economics:** Internal delegation vs. external contracting — AI changes the cost ratios.

---

## 3. MCP Protocol Internals

**Spec:** https://modelcontextprotocol.io/specification/2025-06-18  
**Repo:** https://github.com/modelcontextprotocol/specification  
**Current Version:** 2025-06-18 (latest stable)

### 3.1 Architecture

```
Host (LLM App) ─── Client ─── Server (tools/resources)
                    │
                    └── Client ─── Server
```

- **Host:** LLM application (e.g., Claude Desktop, IDE)
- **Client:** Connector within the host, manages 1:1 connection to a server
- **Server:** Service providing context and capabilities
- Communication via **JSON-RPC 2.0** over stateful connections
- Transport: stdio (local) or HTTP+SSE (remote)

### 3.2 What MCP Covers

**Server Features:**
- **Resources:** Data/context exposed to the model (files, DB entries, API responses)
- **Prompts:** Templated messages and workflows
- **Tools:** Functions the AI model can execute (with name, description, JSON Schema input)

**Client Features:**
- **Sampling:** Server-initiated LLM calls (agentic recursion)
- **Roots:** Filesystem/URI boundaries
- **Elicitation:** Server requests for user input

**Lifecycle:**
1. Capability negotiation (initialize handshake)
2. Tool/resource discovery (listing)
3. Tool invocation (call with parameters)
4. Progress tracking, cancellation, logging

### 3.3 Authorization (June 2025 Update)

- MCP servers are classified as **OAuth 2.1 Resource Servers**
- Clients must implement **Resource Indicators (RFC 8707)** to scope tokens to specific servers
- Supports delegated authorization through third-party authorization servers
- Client credentials grant was removed then re-added as a draft extension

**What's Missing:**
- No concept of **delegation chains** — auth is between client↔server, not A→B→C
- No policy language for expressing what a delegated agent CAN do with a tool
- No attestation or audit trail for tool invocations
- No mechanism for an MCP server to verify that the calling agent has been authorized by a higher-level principal
- The spec says "MCP itself cannot enforce security principles at the protocol level" — it's explicitly punted to implementors

### 3.4 Where a Delegation Layer Would Plug In

```
Host ─── MCP Client ─── [DelegateOS Middleware] ─── MCP Server
                              │
                         DCT Verification
                         Policy Evaluation
                         Audit Logging
                         Chain Attestation
```

The middleware would:
1. Intercept `tools/call` requests
2. Verify the calling agent's DCT against the requested tool's policy
3. Attenuate the DCT before forwarding to sub-agents
4. Log the invocation for audit trail
5. Verify results against the contract before returning

### 3.5 Existing MCP Auth Extensions

- **Cross App Access** (Nov 2025 anniversary release): Organizations can control which apps access which MCP servers
- Stack Overflow (Jan 2026) analysis notes client credentials grant is coming back as draft extension
- No existing extension handles delegation chains or capability tokens

### 3.6 Security Issues

April 2025 security analysis found:
- Prompt injection via tool descriptions
- Tool permissions allowing data exfiltration via tool combinations
- Lookalike tools (tool squatting)
- No built-in sandboxing or permission boundaries

---

## 4. A2A (Agent-to-Agent) Protocol

**Spec:** https://a2a-protocol.org/latest/specification/  
**Announced:** April 9, 2025 at Google Cloud Next  
**Repo:** https://github.com/google/A2A

### 4.1 Core Concepts

**Agent Card:** JSON document describing an agent's capabilities, published at `/.well-known/agent.json`
```json
{
  "name": "Research Agent",
  "description": "Performs deep research on technical topics",
  "url": "https://research-agent.example.com",
  "capabilities": {
    "streaming": true,
    "pushNotifications": true
  },
  "skills": [
    {
      "id": "web_research",
      "name": "Web Research",
      "description": "Search and synthesize information"
    }
  ],
  "authentication": {
    "schemes": ["oauth2"]
  }
}
```

**Task Lifecycle:**
- `submitted` → `working` → `completed` | `failed` | `canceled`
- Tasks have artifacts (outputs) and status updates
- Supports streaming (SSE) for long-running tasks

**Message Flow:**
1. Client discovers agent via Agent Card
2. Client sends `tasks/send` with a message
3. Server processes, optionally streams updates
4. Server returns completed task with artifacts

### 4.2 What's Missing for Delegation

Per the DeepMind paper and analysis:
- **No delegation semantics:** A2A tasks are "fire and forget" — no authority transfer model
- **No capability tokens:** No way to express "this agent can do X but not Y on your behalf"
- **No chain attestation:** No standardized headers for ZKPs or digital signature chains
- **No accountability model:** If agent B delegates to C via A2A, agent A has no visibility
- **No trust/reputation:** Agent cards describe capabilities but not trustworthiness
- **No verifiable completion:** The protocol doesn't define how to verify task results

### 4.3 Current Adoption

- Google ADK (Agent Development Kit) has native A2A support
- Partners: Salesforce, SAP, Atlassian, Box, MongoDB, and others
- Multiple reference implementations (Python, Node.js, Java, Go)
- Growing ecosystem but still early — most production deployments are intra-organization

---

## 5. Multi-Agent Orchestration Frameworks

### 5.1 CrewAI

**Repo:** https://github.com/crewAIInc/crewAI  
**Architecture:** Role-based agents in hierarchical or sequential "crews"

**Delegation Model:**
- Agents have `allow_delegation=True/False` flag
- Hierarchical mode: Manager agent delegates to worker agents
- Sequential mode: Tasks flow linearly between agents
- Delegation is LLM-driven — the model decides who to delegate to based on prompts

**How It Actually Works:**
```python
from crewai import Agent, Task, Crew

researcher = Agent(
    role="Senior Researcher",
    goal="Find relevant papers",
    allow_delegation=False  # leaf node
)

manager = Agent(
    role="Research Manager",
    goal="Coordinate the research team",
    allow_delegation=True  # can delegate to other agents
)

crew = Crew(
    agents=[manager, researcher],
    tasks=[...],
    process=Process.hierarchical,
    manager_agent=manager
)
```

**Limitations (from TDS analysis, Nov 2025):**
- Hierarchical mode doesn't enforce conditional branching — final response determined by whichever task runs last
- No trust verification between agents
- No capability tokens — delegation is pure prompt engineering
- Manager agent is "an LLM doing orchestration via detailed scaffolding prompts"
- Token costs explode with delegation (every delegation = more LLM calls)
- Python-only

### 5.2 AutoGen (Microsoft)

**Repo:** https://github.com/microsoft/autogen  
**Version:** 0.4 (current, event-driven architecture)

**Architecture:**
- Conversation-driven control flow
- Agent "computation" (LLM inference, tool use) and "control flow" (termination, delegation) unified
- v0.4: Asynchronous, event-driven with pub/sub messaging

**Delegation Model:**
- **Two-agent chat:** Simple back-and-forth between agents
- **Group chat:** Multiple agents in conversation, with selection strategies:
  - Round-robin
  - Random
  - LLM-based selection (model picks next speaker)
  - Custom selectors
- **Nested chat:** Sub-conversations triggered within a parent conversation
- **Swarm:** Handoff-based routing where agents transfer control

**What It Does Well:**
- Flexible conversation topologies
- Human-in-the-loop at any point
- Code execution sandboxing (Docker/local)
- AutoGen Studio (no-code GUI)

**What It Doesn't Do:**
- No formal delegation contracts
- No capability verification
- No accountability trails
- Trust is implicit — any agent in the group can speak
- No permission attenuation between delegation levels

### 5.3 LangGraph (LangChain)

**URL:** https://www.langchain.com/langgraph  
**Architecture:** DAG-based state machines for agent orchestration

**How It Works:**
- **Nodes:** Agents, functions, or decision points
- **Edges:** Data flow between nodes (can be conditional)
- **State:** Shared, typed state object passed through the graph
- Built-in persistence, checkpointing, human-in-the-loop

```python
from langgraph.graph import StateGraph

graph = StateGraph(AgentState)
graph.add_node("researcher", research_agent)
graph.add_node("writer", writing_agent)
graph.add_node("reviewer", review_agent)

graph.add_edge("researcher", "writer")
graph.add_conditional_edges("reviewer", should_revise, {
    "revise": "writer",
    "approve": END
})
```

**Strengths:**
- Deterministic routing with conditional edges
- State persistence and checkpointing
- Human-in-the-loop via interrupt nodes
- Subgraphs for nested workflows

**Limitations:**
- Graph must be defined at compile time (not dynamic)
- No inter-organization agent communication
- No trust, capability, or delegation semantics
- State is shared — no information isolation between agents
- Tightly coupled to LangChain ecosystem

### 5.4 OpenClaw sessions_spawn

OpenClaw supports spawning sub-agent sessions from a main agent session:
- Main agent can delegate tasks to subagents
- Subagents run in isolated sessions with their own context
- Results reported back to the main agent asynchronously
- Labels for tracking and identification

**Current limitations:**
- No formal capability tokens
- No policy enforcement on what subagents can access
- No chain attestation or audit trail
- Trust is binary (spawned = trusted)
- No inter-organization delegation

### 5.5 What NONE of Them Solve

| Gap | CrewAI | AutoGen | LangGraph | OpenClaw |
|-----|--------|---------|-----------|----------|
| **Verified delegation** | ❌ | ❌ | ❌ | ❌ |
| **Capability tokens** | ❌ | ❌ | ❌ | ❌ |
| **Transitive accountability** | ❌ | ❌ | ❌ | ❌ |
| **Trust/reputation** | ❌ | ❌ | ❌ | ❌ |
| **Permission attenuation** | ❌ | ❌ | ❌ | ❌ |
| **Cross-org delegation** | ❌ | ❌ | ❌ | ❌ |
| **Verifiable completion** | ❌ | ❌ | Partial (checkpoints) | ❌ |
| **Payment for delegated work** | ❌ | ❌ | ❌ | ❌ |

**Every framework assumes all agents are trusted and co-located.** None handles the open-market, cross-organization scenario that the DeepMind paper identifies as the future.

---

## 6. Agent Payment Protocols

### 6.1 Visa: Trusted Agent Protocol + Intelligent Commerce

**Trusted Agent Protocol:**
- **Repo:** https://github.com/visa/trusted-agent-protocol
- Developed with Cloudflare
- Establishes trust between AI agents and merchants
- Protection against replay attacks (time-sensitive signatures)
- Standardized way for verified agents to pass customer/payment info to merchants
- Available on Visa Developer Center + GitHub (Oct 2025)

**Visa Intelligent Commerce:**
- Platform for managing agent-initiated payments
- **MCP Integration:** https://github.com/visa/mcp — toolkit for connecting agents to Visa platform via MCP
- Flow: User authenticates → Agent requests payment credentials → VisaNet validates → Controls enforced → Transaction processed
- Guest checkout via key entry (form fill) initially

**Partners:** Microsoft, Shopify, Stripe, Worldpay, Nuvei

**Status:** Hundreds of live AI-initiated transactions completed (Dec 2025). Visa predicts mainstream agentic commerce in 2026.

### 6.2 Mastercard: Agent Pay

- **URL:** https://www.mastercard.com/us/en/business/artificial-intelligence/mastercard-agent-pay.html
- All US Mastercard cardholders enabled by holiday season 2025, global rollout following
- Launch partners: Citi, US Bank, PayOS, Firmly.AI, Basis Theory
- PayPal integration announced (Oct 2025)
- Expected 20% of e-commerce tasks handled by agentic AI in 2025

### 6.3 Stripe: Agentic Commerce Suite

- **URL:** https://stripe.com/use-cases/agentic-commerce
- **Launched:** Dec 2025
- Three pillars:
  1. **Discoverability:** Make products findable by AI agents
  2. **Simplified checkout:** Agent-optimized payment flows
  3. **Agentic payments:** Single integration for agent-initiated transactions
- **Link wallet:** Purpose-built for agentic commerce — spending limits, explicit permissions for agents
- Powers 78% of Forbes AI 50; 700+ AI agent startups launched on Stripe in 2024

### 6.4 AP2 (Agent Payments Protocol)

- **Spec:** https://ap2-protocol.org/
- **Repo:** https://github.com/google-agentic-commerce/AP2
- **License:** Apache 2.0
- Open protocol, extension for A2A (with MCP integration in progress)

**Core Concept: Verifiable Digital Credentials (VDCs)**

Three types:
1. **Intent Mandate:** Conditions under which an agent can purchase (human-not-present). Cryptographically signed authority with constraints (spending limit, merchant category, time window).
2. **Cart Mandate:** User's explicit authorization for a specific cart (human-present). Non-repudiable proof of intent.
3. **Payment Mandate:** Shared with payment network/issuer, signals AI agent involvement and user presence status.

**Key Design Principles:**
- Verifiable intent, not inferred action
- Clear transaction accountability via cryptographic audit trail
- Role-based architecture protecting PCI data and PII
- Agents never see raw payment credentials

**Partners:** 60+ including Mastercard, Adyen, PayPal, Coinbase

**Roadmap:** Currently supports "pull" payments (cards). "Push" payments (UPI, PIX, digital currencies) planned.

### 6.5 UCP (Universal Commerce Protocol)

- **Spec:** https://developers.google.com/merchant/ucp
- **Repo:** https://github.com/Universal-Commerce-Protocol/ucp
- **Launched:** Jan 2026

**Purpose:** Standardize the full end-to-end shopping journey for AI agents.

**Architecture:**
- Modular **Capabilities** (e.g., "Checkout", "Identity Linking") that businesses implement
- **Extensions** for enhanced features without bloating core capabilities
- Interoperable with A2A, AP2, MCP
- Vendor-agnostic, any platform/surface

**Limitations per DeepMind paper:** Optimized for shopping/fulfillment, not abstract computational tasks. Not suitable for "pay an agent to do research for me."

### 6.6 Payments × Delegation Intersection

**The critical gap:** None of these protocols handle **paying for delegated computational work**. They all assume a human→agent→merchant flow for purchasing goods. The scenario of:

> Agent A delegates a research task to Agent B, which costs $0.50 in compute. Agent A's DCT authorizes up to $2.00 for this delegation chain. Agent B delegates sub-tasks to C and D, splitting the budget.

...is not addressed by any existing payment protocol. This is a **key opportunity for DelegateOS**: integrating DCTs with payment mandates so that delegation authority and spending authority are unified.

**AP2's VDC model** (Intent Mandate → Cart Mandate → Payment Mandate) could be adapted:
- **Delegation Mandate** = Intent Mandate for computational work (not shopping)
- **Completion Attestation** = Cart Mandate equivalent (verified work before payment release)
- **Settlement Mandate** = Payment Mandate for compute credits/micropayments

---

## 7. Competitive Landscape

### 7.1 Who's Building Delegation Infrastructure?

**Nobody is building exactly what DelegateOS proposes.** The closest efforts:

- **Google's protocol stack (A2A + AP2 + UCP + MCP):** Covers communication, payments, and commerce but explicitly lacks the delegation/policy layer the DeepMind paper calls for
- **ISACA (Jan 2025):** Published analysis of "The Looming Authorization Crisis" — current IAM fails agentic AI, especially multi-entity delegations
- **Hacker News (Jan 2026):** "Who Approved This Agent?" article highlighting that agents get broader access than the humans they represent
- **Chamber (YC):** Agentic AI infrastructure orchestration — focused on GPU/compute management, not delegation semantics
- **Legion ($38M):** Enterprise AI infrastructure — data transformation and model orchestration, not agent-to-agent delegation

### 7.2 VC Funding in Agent Orchestration (2025-2026)

- AI agent startups represent a massive share of venture funding
- "The era of experimental AI Agents ends in 2026" — VCs betting on deployed architectures with governance (a16z, Google, Gartner)
- Waymo raised $16B (early 2026) — autonomous systems commanding huge capital
- **Gap in market:** Lots of funding for agent frameworks (building agents) but almost zero for agent governance infrastructure (controlling delegation between agents)

### 7.3 Developer Pain Points (Reddit, HN, Community)

From r/AI_Agents (Jul 2025):
> "The semi-autonomous magic gets all the oxygen, but the boring scaffolding — context, memory design, safe delegation, recovery from failure — gets ignored."

Key pain points identified across developer communities:

1. **No trust boundary between agents:** "I can't safely let my agent call your agent without giving it full access to everything"
2. **Audit trail is nonexistent:** When a multi-agent system fails, debugging which agent made which decision is nearly impossible
3. **Cost explosion with delegation:** Each delegation = more LLM calls, no way to budget or cap spending in delegation chains
4. **No revocation:** Once an agent has been delegated to, there's no standard way to revoke that delegation mid-task
5. **The "human present" assumption:** All existing auth assumes a human is in the loop. Agent-to-agent auth is an afterthought.
6. **Framework lock-in:** CrewAI agents can't talk to AutoGen agents. No interoperability.

### 7.4 OWASP Top 10 for LLM Apps (Feb 2025)

OWASP explicitly identified agent delegation as a threat vector:
- Agents maintain memory, increasing autonomy
- Agents can delegate execution to other agents
- Delegation chains create expanded attack surfaces

---

## 8. Synthesis: The DelegateOS Opportunity

### 8.1 The Gap

```
┌─────────────────────────────────────────────────┐
│              What Exists Today                   │
├─────────────────────────────────────────────────┤
│ MCP: Model ↔ Tool communication                 │
│ A2A: Agent ↔ Agent task passing                  │
│ AP2: Agent → Merchant payments                   │
│ UCP: Agent commerce workflows                    │
│ CrewAI/AutoGen/LangGraph: Single-org orchestration│
└─────────────────────────────────────────────────┘
                     ↕ GAP ↕
┌─────────────────────────────────────────────────┐
│          What DelegateOS Would Provide           │
├─────────────────────────────────────────────────┤
│ DCTs: Cryptographic delegation authority          │
│ Policy engine: Datalog-based permission evaluation│
│ Chain attestation: Transitive accountability      │
│ Trust/reputation: Agent capability verification   │
│ Budget propagation: Spending limits in chains     │
│ Verifiable completion: Contract-first verification│
│ Revocation: Real-time delegation revocation       │
└─────────────────────────────────────────────────┘
```

### 8.2 Key Architecture Decisions to Make

1. **Token format:** Biscuit (recommended) vs UCAN vs hybrid
2. **Identity model:** DIDs vs agent cards vs both
3. **Policy language:** Biscuit's Datalog subset vs custom DSL
4. **Integration points:** MCP middleware vs A2A extension vs standalone protocol
5. **Payment integration:** Extend AP2 VDCs for computational work vs build separate
6. **Verification model:** How to implement contract-first decomposition in practice
7. **Trust bootstrapping:** How do agents build reputation from zero?

### 8.3 References

- DeepMind paper: https://arxiv.org/abs/2602.11865
- MCP spec: https://modelcontextprotocol.io/specification/2025-06-18
- A2A spec: https://a2a-protocol.org/latest/specification/
- AP2 spec: https://ap2-protocol.org/
- UCP: https://github.com/Universal-Commerce-Protocol/ucp
- Biscuit: https://github.com/eclipse-biscuit/biscuit
- UCAN: https://github.com/ucan-wg/spec
- Macaroons paper: https://theory.stanford.edu/~ataly/Papers/macaroons.pdf
- Visa Trusted Agent Protocol: https://github.com/visa/trusted-agent-protocol
- Visa MCP Integration: https://github.com/visa/mcp
- Stripe Agentic Commerce: https://stripe.com/use-cases/agentic-commerce
- Mastercard Agent Pay: https://www.mastercard.com/us/en/business/artificial-intelligence/mastercard-agent-pay.html
