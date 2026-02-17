## Architecture Review — Iteration 1

### Scores
- Security Model: 7/10
- Protocol Completeness: 5/10
- MCP Integration: 7/10
- Practical Buildability: 5/10
- Contract-First Design: 4/10
- TypeScript Interfaces: 5/10
- **Overall: 5.5/10**

### Verdict: FAIL

---

### Critical Issues (must fix)

**1. Biscuit WASM dependency is a house of cards**

The architecture bets everything on `@biscuit-auth/biscuit-wasm ^3.2.0`. This package does not exist as a stable, well-maintained npm library. The Biscuit ecosystem is Rust-first; the WASM bindings are experimental, poorly documented, and have had breaking API changes. The entire DCT engine depends on this single dependency. If it doesn't work as expected (likely), you're blocked on day 1.

**Action:** Build a proof-of-concept that creates, attenuates, and verifies a Biscuit token using the actual WASM package *before* committing to this architecture. Have a fallback plan (e.g., spawn a Rust sidecar, or implement a simplified Datalog engine in TS).

**2. Contract verification is hand-wavy — `deterministic_check` and `llm_judge` are underspecified**

- `deterministic_check`: What is `checkFunction`? A string identifier. Where is the function registry? How are functions loaded? Can a malicious agent register a check function that always returns true? The spec says `loadCheckFunction(contract.verification.checkFunction)` but never defines loading semantics.
- `llm_judge`: Which LLM? What model? Who pays for the judge call? What if the judge is biased or inconsistent? What's the prompt template? A bare `judgePrompt` string with a `passThreshold` is not a verification specification — it's a wish.
- `composite`: Says "all must pass" but doesn't define ordering semantics, short-circuit behavior, or how to handle partial failures.

**Action:** Define a concrete `CheckFunctionRegistry` interface with sandboxed execution. For `llm_judge`, specify the model, temperature, and require multiple evaluations with consensus. For `composite`, define execution order and failure semantics explicitly.

**3. No revocation distribution mechanism**

The spec defines `RevocationEntry` and says "verifiers check revocation list" but never specifies:
- How revocations propagate between agents
- Whether it's push (notification) or pull (polling)
- What happens if an agent doesn't receive a revocation in time
- Consistency guarantees (eventual? strong?)
- The `delegateos/revoke` JSON-RPC message exists but there's no gossip protocol, no pub/sub, no revocation endpoint on Agent Cards

A stolen DCT remains valid until the revocation somehow reaches every verifier. This is a critical security gap.

**Action:** Specify a revocation distribution mechanism. At minimum: add a `revocationEndpoint` to Agent Cards, define a polling interval, and accept that revocation is eventually consistent with a bounded propagation delay.

**4. Trust score system is trivially gameable**

- An agent can create sock puppet identities, delegate easy tasks to itself, and accumulate perfect trust scores
- Sybil attack: spin up N agents, have them rate each other highly via `peerRating`
- The `confidenceThreshold` of 20 tasks is low — an attacker can bootstrap a trusted identity in hours
- No mechanism to weight trust by the *difficulty* or *value* of completed tasks
- The Bayesian prior of 0.5 means new agents start with moderate trust — potentially too generous for high-stakes delegation

**Action:** Add Sybil resistance. Options: (a) weight trust events by the trust score of the *delegator* (recursive trust), (b) require proof-of-stake or registration costs, (c) distinguish between self-delegated and externally-delegated tasks. Increase confidence threshold or add a "probationary" tier.

---

### Warnings (should fix)

**5. Types are "see protocol-spec.md" — not actually defined in types.ts**

The architecture doc's `core/types.ts` says things like `export interface TaskContract { /* see protocol-spec.md §4.1 */ }`. This is not a type definition — it's a pointer. The protocol-spec defines the shapes in prose/TypeScript, but there are subtle inconsistencies:
- `Delegation.dct` is `string` in §7.1 but `SerializedDCT` has a `token: string` + `version` wrapper. Which is stored in the chain?
- `AttestationResult.output` is `unknown` — but the verification engine needs to validate it against `outputSchema`. How does this work with serialization? Is `output` stored as canonical JSON?
- `TrustEvent` defines `deadlineMs` and `durationMs` but the trust calculation computes `deadlineMs / durationMs` — this is inverted from the description ("1.0 = on time, <1.0 = late"). If the deadline is 10000ms and duration is 5000ms, this gives 2.0 which is clamped to 1.0. But if duration exceeds deadline, it gives <1.0. The description and formula don't match the field names clearly.

**Action:** Consolidate all types into one authoritative source with no forward references. Add JSDoc comments explaining invariants.

**6. MCP proxy doesn't handle initialization handshake**

The MCP middleware flow only addresses `tools/call`. But MCP has a multi-step lifecycle: `initialize` → capability negotiation → `tools/list` → `tools/call`. The proxy needs to:
- Forward `initialize` and inject DelegateOS capabilities
- Handle `tools/list` to filter tools based on DCT scope (agent should only see tools they're authorized for)
- Handle connection lifecycle (reconnection, cancellation)
- Support both stdio and HTTP+SSE transports

The current design assumes the proxy just intercepts individual requests, but it needs to manage the full session.

**Action:** Define the full proxy lifecycle, including how it handles `initialize`, `tools/list` filtering, and transport management.

**7. No error recovery or partial failure handling**

What happens when:
- A sub-delegate fails midway and has already spent budget?
- An attestation chain has one invalid link but the rest are valid?
- A DCT expires during task execution?
- The trust store is unavailable when checking `minTrustScore`?

The spec is entirely happy-path. Real systems need compensation transactions, partial rollback, and graceful degradation.

**Action:** Define failure modes and recovery strategies for each module. At minimum: what happens to spent budget on failure, and how does the chain handle partial completion.

**8. Budget tracking is per-delegation but attacks are cross-delegation**

`budgetTracker: Map<string, number>` tracks spend per delegation ID. But an attacker with multiple delegations from the same root could drain the root's total budget by exploiting the fact that individual delegations don't know about each other's spending. The spec doesn't define a mechanism for the root to track aggregate spending across all delegations.

**Action:** Add hierarchical budget tracking — each node in the delegation tree should know its remaining budget *including* all children's spending.

**9. The `_delegateos` field in MCP requests is fragile**

Injecting a custom `_delegateos` field into MCP `tools/call` params is clever but risky:
- Future MCP spec versions could reject unknown fields
- Some MCP servers might pass unknown fields through to underlying tools, causing errors
- There's no MCP extension mechanism being used — this is just smuggling data in params

**Action:** Consider using MCP's HTTP headers (`X-DelegateOS-DCT`) for HTTP transport or proposing a proper MCP extension. For stdio, the params approach is probably fine but should be documented as transport-dependent.

**10. No persistent storage story**

Everything uses `MemoryChainStore`, `MemoryTrustStore`, `MemoryAttestationStore`. This is fine for demos, but:
- Trust scores vanish on restart
- Attestation chains are lost
- Revocations disappear
- There's no `Store` interface that maps cleanly to SQLite/Postgres/Redis

**Action:** Design the store interfaces to be persistence-ready from day 1. Add a SQLite implementation alongside the memory ones.

---

### Feedback

**The architecture is ambitious and well-researched but tries to boil the ocean.** The research findings are excellent — the gap analysis is spot-on and the Biscuit recommendation is sound. But the architecture doc tries to build everything at once: DCTs + contracts + attestations + trust + MCP plugin + A2A extension + demos, all in 5 weeks.

**Specific recommendations:**

1. **Validate Biscuit WASM first.** Spend 2 days building a standalone TS script that creates a Biscuit token with Datalog facts, attenuates it, and verifies it. If this doesn't work smoothly, the entire architecture needs to change. This is the #1 risk.

2. **Cut scope ruthlessly.** For v0.1, ship: DCT create/attenuate/verify + MCP middleware + one demo. Drop trust scoring, A2A integration, and contract decomposition to v0.2. You can hard-code trust scores and use schema_match as the only verification method.

3. **The 80% alternative:** If Biscuit WASM is too painful, consider: Ed25519-signed JSON tokens with a simple capability list and expiration. No Datalog, no attenuation blocks — just a signed capability certificate that's verified on each request. You lose elegant attenuation but gain implementability. Attenuation can be implemented as "mint a new, narrower token signed by the parent" rather than Biscuit's block-append model.

4. **Contract verification needs a concrete registry.** Define 3 built-in verification methods with exact implementations: (a) JSON Schema validation via ajv, (b) string equality check, (c) output length/structure check. Defer LLM-judge and human-review to v0.2.

5. **The trust system should be external.** Trust scoring is a whole product by itself. For v0.1, accept trust scores as input (e.g., from an Agent Card) rather than computing them internally. Build the trust engine when you have real data to calibrate against.

6. **Add a threat model document.** The security section lists mitigations but doesn't systematically enumerate threats. Use STRIDE or similar. Key questions that aren't answered: What if the MCP server is malicious? What if the LLM judge is compromised? What if two colluding agents forge an attestation chain?

**Bottom line:** The vision is right, the research is thorough, the gap is real. But the architecture overcommits. Narrow the scope to DCT + MCP middleware, validate the Biscuit dependency, ship something that works end-to-end, then iterate.
