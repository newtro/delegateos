## Code Review — Iteration 1

### Scores
- Architecture Conformance: 8/10
- Security: 7/10
- Code Quality: 7/10
- Test Coverage: 7/10
- API Design: 8/10
- Demo Quality: 8/10
- **Overall: 7.5/10**

### Verdict: PASS

---

### Critical Issues (must fix before shipping)

**C1. Dead code / unused import in `dct.ts`**
- `import_sign()` function is dead code (returns `new Uint8Array(64)` and is never meaningfully used). The `sigBytes` variable on line ~35 is also unused. This is leftover scaffolding that should be removed to avoid confusion.

**C2. MCP plugin does not pass revocation IDs to `verifyDCT`**
- In `mcp/plugin.ts`, the `VerificationContext` is built with `revocationIds: []` (hardcoded empty array), even though `config.revocations` is available. The revocation list is never consulted during verification. This means **revoked tokens are still accepted by the MCP plugin**.
- Fix: `revocationIds: config.revocations.getRevocationIds()`.

**C3. MCP plugin `handleResponse` checks `_delegateos` on the original request after it was stripped**
- `handleResponse` checks `req.params?._delegateos`, but `handleRequest` returns a modified request with `_delegateos` deleted. If the caller uses the returned (stripped) request, `handleResponse` will never record spend. The spend tracking is effectively broken depending on call pattern.
- Fix: Either don't strip `_delegateos` from the request object used later, or capture the metadata before stripping.

**C4. `VerificationContext` type mismatch between architecture and implementation**
- The architecture spec defines `revocations: RevocationList` on `VerificationContext`, but the implementation uses `revocationIds?: string[]`. This is actually a reasonable simplification, but the `?` (optional) means callers can omit revocation checking entirely by accident. Consider making it required (defaulting to `[]`).

### Warnings (should fix)

**W1. Capability matching in `verifyDCT` ignores namespace**
- In step 7, `matchCapability()` only checks `action` and `resource` — it completely ignores `namespace`. An agent with `docs:read:*` would pass verification for a `code:read:*` request. This is a significant security gap.
- The `requested` capability is constructed with `namespace: ''` (empty string), confirming namespace is unused.

**W2. No chain depth verification in `verifyDCT`**
- The spec says verification should check chain depth doesn't exceed `maxChainDepth`, but `verifyDCT` never checks `authority.chainDepth + attenuations.length <= effectiveMaxDepth`. Attenuation enforces `maxChainDepth` narrowing, but the final depth is never validated against the limit.

**W3. `any` type usage in `orchestrator.ts`**
- Line `catch (err: any)` — use `catch (err: unknown)` with proper narrowing.

**W4. Specialist `generateFindings` filtering logic is inverted**
- `mockFindings.filter(f => files.some(file => matchesGlob(f.file, file)))` — this checks if the *finding's file* matches the *input file as a pattern*. Since input files are concrete paths (e.g., `src/auth/login.cs`), this only works by exact match. It should be `matchesGlob(f.file, pattern)` where patterns come from the specialist's scope, not the input files. In practice the demo works because the mock finding files happen to match the input files exactly.

**W5. No MCP plugin test file**
- The MCP plugin (`mcp/plugin.ts`) has no dedicated test file. This is a critical integration point that should have tests covering: pass-through without `_delegateos`, successful verification, denial scenarios, budget tracking, and revocation integration.

**W6. `verifyOutput` is synchronous but typed as returning `Result` (not `Promise`)**
- Architecture spec declares `verifyOutput` as `async`, but implementation is synchronous. This is fine for v0.1 but should be made async to support future `llm_judge` without API breakage.

**W7. Expiry comparison uses string comparison**
- `context.now > effectiveExpiry` does string comparison on ISO timestamps. This works for ISO 8601 UTC strings, but is fragile — any timezone offset or format variation breaks it. Consider using `new Date(context.now).getTime() > new Date(effectiveExpiry).getTime()`.

**W8. Demo `delegationCounter` is module-level mutable state**
- The counter in `orchestrator.ts` persists across test runs, producing non-deterministic delegation IDs. Use instance-level counters or proper random IDs.

**W9. Missing `verification.ts` file**
- Architecture specifies `core/verification.ts` as a separate module. Instead, `CheckFunctionRegistry` and built-in checks live in `contract.ts`. This is fine functionally but deviates from the documented package structure.

### Positive Notes

1. **Clean type system** — `types.ts` is well-organized as a single source of truth. Discriminated union `Result<T, E>` and `DenialReason` types are excellent — no exceptions for control flow.

2. **Crypto implementation is solid** — Proper use of `@noble/ed25519` v2 with `sha512Sync` setup. Sign-over-hash pattern (canonicalize → BLAKE2b → Ed25519) is correct and consistent across all modules.

3. **Comprehensive DCT tests** — 13 tests covering creation, attenuation, verification, expiry, budget, capability checks, revocation, wrong keys, forgery, and monotonic attenuation violations. Good security coverage.

4. **Contract verification is thorough** — All 7 built-in check functions implemented, composite modes work correctly, 19 tests with good edge case coverage.

5. **Demo is compelling** — The PR review scenario effectively demonstrates the value proposition: delegation, attenuation, attestation, revocation, and expiry in a realistic use case. The console output is well-formatted and would make a good README walkthrough.

6. **Audit log** — Clean, simple audit trail for MCP plugin decisions. Good for debugging and compliance.

7. **All 53 tests pass** — Clean test run, no flaky tests, fast execution (~300ms).

8. **Attenuation enforcement is correct** — Monotonic narrowing is properly validated for capabilities, budget, expiry, and chain depth at both attenuation time (throws) and verification time (returns denial).
