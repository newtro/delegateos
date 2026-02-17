/**
 * Biscuit Token Backend — Datalog-based capability authorization engine.
 * Implements a minimal Datalog evaluator and a DCT engine using Biscuit-compatible token format.
 */

import type {
  DCTCreateParams,
  DCTAttenuateParams,
  SerializedDCT,
  VerificationContext,
  AuthorizedScope,
  DenialReason,
  Result,
  Capability,
  SignedJSONToken,
} from './types.js';
import {
  toBase64url,
  fromBase64url,
  canonicalize,
  blake2b256,
  signObject,
  verifyObjectSignature,
} from './crypto.js';
import { _matchGlob as matchGlobShared, createDCT as createSJTDCT, attenuateDCT as attenuateSJTDCT, verifyDCT as verifySJTDCT } from './dct.js';

// ── Datalog Types ──

export interface Fact {
  name: string;
  terms: string[];
}

export interface Rule {
  head: Fact;
  body: Fact[];
  constraints?: Array<{
    variable: string;
    op: '==' | '!=' | '<' | '>' | '<=' | '>=';
    value: string;
  }>;
}

export interface Check {
  /** "check if" — must have at least one matching rule */
  rules: Rule[];
}

export interface Policy {
  kind: 'allow' | 'deny';
  rules: Rule[];
}

// ── Datalog Evaluator ──

export class DatalogEvaluator {
  private facts: Fact[] = [];
  private rules: Rule[] = [];
  private checks: Check[] = [];
  private policies: Policy[] = [];

  addFact(fact: Fact): void {
    this.facts.push(fact);
  }

  addRule(rule: Rule): void {
    this.rules.push(rule);
  }

  addCheck(check: Check): void {
    this.checks.push(check);
  }

  addPolicy(policy: Policy): void {
    this.policies.push(policy);
  }

  /**
   * Forward-chaining evaluation: apply rules until no new facts are generated.
   */
  evaluate(): void {
    let changed = true;
    let iterations = 0;
    const maxIterations = 100;

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      for (const rule of this.rules) {
        const newFacts = this.applyRule(rule);
        for (const fact of newFacts) {
          if (!this.hasFact(fact)) {
            this.facts.push(fact);
            changed = true;
          }
        }
      }
    }
  }

  /**
   * Run all checks. Returns true if all checks pass.
   */
  runChecks(): { passed: boolean; failedCheck?: number } {
    for (let i = 0; i < this.checks.length; i++) {
      const check = this.checks[i];
      // A check passes if at least one of its rules matches
      const passes = check.rules.some(rule => this.applyRule(rule).length > 0);
      if (!passes) {
        return { passed: false, failedCheck: i };
      }
    }
    return { passed: true };
  }

  /**
   * Evaluate policies. Returns the first matching policy's kind.
   */
  runPolicies(): 'allow' | 'deny' | null {
    for (const policy of this.policies) {
      const matches = policy.rules.some(rule => this.applyRule(rule).length > 0);
      if (matches) return policy.kind;
    }
    return null;
  }

  getFacts(): Fact[] {
    return [...this.facts];
  }

  private hasFact(fact: Fact): boolean {
    return this.facts.some(
      f => f.name === fact.name && f.terms.length === fact.terms.length &&
        f.terms.every((t, i) => t === fact.terms[i])
    );
  }

  /**
   * Apply a rule against the current fact set, returning generated head facts.
   * Supports joins across multiple body atoms via unification.
   */
  private applyRule(rule: Rule): Fact[] {
    const results: Fact[] = [];
    const bindings = this.matchBody(rule.body, 0, new Map());

    for (const binding of bindings) {
      // Check constraints
      if (rule.constraints) {
        let pass = true;
        for (const c of rule.constraints) {
          const val = binding.get(c.variable);
          if (val === undefined) { pass = false; break; }
          if (!evalConstraint(val, c.op, c.value)) { pass = false; break; }
        }
        if (!pass) continue;
      }

      // Generate head fact with bound variables
      const headTerms = rule.head.terms.map(t => {
        if (t.startsWith('$')) {
          return binding.get(t) ?? t;
        }
        return t;
      });
      results.push({ name: rule.head.name, terms: headTerms });
    }

    return results;
  }

  /**
   * Recursively match body atoms, building up variable bindings.
   */
  private matchBody(
    body: Fact[],
    index: number,
    bindings: Map<string, string>
  ): Map<string, string>[] {
    if (index >= body.length) return [new Map(bindings)];

    const atom = body[index];
    const results: Map<string, string>[] = [];

    for (const fact of this.facts) {
      if (fact.name !== atom.name || fact.terms.length !== atom.terms.length) continue;

      const newBindings = new Map(bindings);
      let match = true;

      for (let i = 0; i < atom.terms.length; i++) {
        const term = atom.terms[i];
        const value = fact.terms[i];

        if (term.startsWith('$')) {
          const existing = newBindings.get(term);
          if (existing !== undefined) {
            if (existing !== value) { match = false; break; }
          } else {
            newBindings.set(term, value);
          }
        } else if (term !== value) {
          match = false;
          break;
        }
      }

      if (match) {
        results.push(...this.matchBody(body, index + 1, newBindings));
      }
    }

    return results;
  }
}

function evalConstraint(val: string, op: string, ref: string): boolean {
  // Try numeric comparison first
  const nVal = Number(val);
  const nRef = Number(ref);
  if (!isNaN(nVal) && !isNaN(nRef)) {
    switch (op) {
      case '==': return nVal === nRef;
      case '!=': return nVal !== nRef;
      case '<': return nVal < nRef;
      case '>': return nVal > nRef;
      case '<=': return nVal <= nRef;
      case '>=': return nVal >= nRef;
    }
  }
  // String comparison
  switch (op) {
    case '==': return val === ref;
    case '!=': return val !== ref;
    case '<': return val < ref;
    case '>': return val > ref;
    case '<=': return val <= ref;
    case '>=': return val >= ref;
    default: return false;
  }
}

// ── Biscuit Token Format ──

interface BiscuitBlock {
  facts: Fact[];
  rules: Rule[];
  checks: Check[];
  context?: string;
  signer: string;
  signature: string;
}

interface BiscuitToken {
  format: 'delegateos-biscuit-v1';
  authority: BiscuitBlock;
  blocks: BiscuitBlock[];
  policies: Policy[];
}

// ── Biscuit DCT Engine ──

/**
 * Create a Biscuit-format DCT.
 */
export function createBiscuitDCT(params: DCTCreateParams): SerializedDCT {
  const facts: Fact[] = [];

  // Add capability facts
  for (const cap of params.capabilities) {
    facts.push({ name: 'right', terms: [cap.namespace, cap.action, cap.resource] });
  }

  // Add metadata facts
  facts.push({ name: 'issuer', terms: [params.issuer.principal.id] });
  facts.push({ name: 'delegatee', terms: [params.delegatee.id] });
  facts.push({ name: 'contract', terms: [params.contractId] });
  facts.push({ name: 'delegation', terms: [params.delegationId] });
  facts.push({ name: 'parent_delegation', terms: [params.parentDelegationId] });
  facts.push({ name: 'chain_depth', terms: [String(params.chainDepth)] });
  facts.push({ name: 'max_chain_depth', terms: [String(params.maxChainDepth)] });
  facts.push({ name: 'max_budget', terms: [String(params.maxBudgetMicrocents)] });
  facts.push({ name: 'expires_at', terms: [params.expiresAt] });
  facts.push({ name: 'issued_at', terms: [new Date().toISOString()] });

  const checks: Check[] = [
    // Expiry check
    {
      rules: [{
        head: { name: 'check_expiry', terms: [] },
        body: [{ name: 'expires_at', terms: ['$exp'] }, { name: 'current_time', terms: ['$now'] }],
        constraints: [{ variable: '$now', op: '<=', value: '{expires_at}' }],
      }],
    },
  ];

  const authorityBlock: BiscuitBlock = {
    facts,
    rules: [],
    checks,
    context: 'authority',
    signer: params.issuer.principal.id,
    signature: '',
  };

  // Sign the authority block
  const toSign = { facts, rules: [], checks, context: 'authority' };
  authorityBlock.signature = signObject(params.issuer.privateKey, toSign);

  const token: BiscuitToken = {
    format: 'delegateos-biscuit-v1',
    authority: authorityBlock,
    blocks: [],
    policies: [
      {
        kind: 'allow',
        rules: [{
          head: { name: 'allow', terms: [] },
          body: [{ name: 'right', terms: ['$ns', '$action', '$resource'] }],
        }],
      },
    ],
  };

  return serializeBiscuit(token);
}

/**
 * Attenuate a Biscuit-format DCT.
 */
export function attenuateBiscuitDCT(params: DCTAttenuateParams): SerializedDCT {
  const token = deserializeBiscuit(params.token);

  // Get current delegatee
  const currentDelegatee = token.blocks.length > 0
    ? getFactValue(token.blocks[token.blocks.length - 1].facts, 'delegatee')
    : getFactValue(token.authority.facts, 'delegatee');

  if (params.attenuator.principal.id !== currentDelegatee) {
    throw new Error('Attenuator must be the current delegatee');
  }

  const facts: Fact[] = [
    { name: 'delegatee', terms: [params.delegatee.id] },
    { name: 'delegation', terms: [params.delegationId] },
    { name: 'contract', terms: [params.contractId] },
  ];

  if (params.allowedCapabilities) {
    for (const cap of params.allowedCapabilities) {
      facts.push({ name: 'right', terms: [cap.namespace, cap.action, cap.resource] });
    }
  }

  if (params.maxBudgetMicrocents !== undefined) {
    facts.push({ name: 'max_budget', terms: [String(params.maxBudgetMicrocents)] });
  }

  if (params.expiresAt !== undefined) {
    facts.push({ name: 'expires_at', terms: [params.expiresAt] });
  }

  if (params.maxChainDepth !== undefined) {
    facts.push({ name: 'max_chain_depth', terms: [String(params.maxChainDepth)] });
  }

  const block: BiscuitBlock = {
    facts,
    rules: [],
    checks: [],
    context: `attenuation_${token.blocks.length}`,
    signer: params.attenuator.principal.id,
    signature: '',
  };

  const toSign = {
    facts,
    rules: [],
    checks: [],
    context: block.context,
    previousBlocks: token.blocks.length + 1,
  };
  block.signature = signObject(params.attenuator.privateKey, toSign);

  token.blocks.push(block);
  return serializeBiscuit(token);
}

/**
 * Verify a Biscuit-format DCT.
 */
export function verifyBiscuitDCT(
  serialized: SerializedDCT,
  context: VerificationContext
): Result<AuthorizedScope, DenialReason> {
  let token: BiscuitToken;
  try {
    token = deserializeBiscuit(serialized);
  } catch {
    return { ok: false, error: { type: 'malformed_token', detail: 'Failed to deserialize biscuit token' } };
  }

  // Verify authority signature
  const authSigner = token.authority.signer;
  if (authSigner !== context.rootPublicKey) {
    return { ok: false, error: { type: 'invalid_signature', detail: 'Authority signer does not match root' } };
  }

  const authToVerify = {
    facts: token.authority.facts,
    rules: token.authority.rules,
    checks: token.authority.checks,
    context: token.authority.context,
  };
  if (!verifyObjectSignature(authSigner, authToVerify, token.authority.signature)) {
    return { ok: false, error: { type: 'invalid_signature', detail: 'Authority block signature invalid' } };
  }

  // Verify block signatures
  for (let i = 0; i < token.blocks.length; i++) {
    const block = token.blocks[i];
    const blockToVerify = {
      facts: block.facts,
      rules: block.rules,
      checks: block.checks,
      context: block.context,
      previousBlocks: i + 1,
    };
    if (!verifyObjectSignature(block.signer, blockToVerify, block.signature)) {
      return { ok: false, error: { type: 'invalid_signature', detail: `Block ${i} signature invalid` } };
    }
  }

  // Build effective state from authority + last block overrides
  let capabilities = getCapabilities(token.authority.facts);
  let maxBudget = Number(getFactValue(token.authority.facts, 'max_budget') ?? '0');
  let expiresAt = getFactValue(token.authority.facts, 'expires_at') ?? '';
  let maxChainDepth = Number(getFactValue(token.authority.facts, 'max_chain_depth') ?? '10');
  const chainDepth = Number(getFactValue(token.authority.facts, 'chain_depth') ?? '0');
  let lastDelegatee = getFactValue(token.authority.facts, 'delegatee') ?? '';
  let lastContractId = getFactValue(token.authority.facts, 'contract') ?? '';
  let lastDelegationId = getFactValue(token.authority.facts, 'delegation') ?? '';

  for (const block of token.blocks) {
    const blockCaps = getCapabilities(block.facts);
    if (blockCaps.length > 0) capabilities = blockCaps;

    const blockBudget = getFactValue(block.facts, 'max_budget');
    if (blockBudget !== null) maxBudget = Number(blockBudget);

    const blockExpiry = getFactValue(block.facts, 'expires_at');
    if (blockExpiry !== null) expiresAt = blockExpiry;

    const blockDepth = getFactValue(block.facts, 'max_chain_depth');
    if (blockDepth !== null) maxChainDepth = Number(blockDepth);

    const blockDelegatee = getFactValue(block.facts, 'delegatee');
    if (blockDelegatee !== null) lastDelegatee = blockDelegatee;

    const blockContract = getFactValue(block.facts, 'contract');
    if (blockContract !== null) lastContractId = blockContract;

    const blockDelegation = getFactValue(block.facts, 'delegation');
    if (blockDelegation !== null) lastDelegationId = blockDelegation;
  }

  // Check expiry
  if (context.now > expiresAt) {
    return { ok: false, error: { type: 'expired' } };
  }

  // Check budget
  if (context.spentMicrocents >= maxBudget) {
    return { ok: false, error: { type: 'budget_exceeded', limit: maxBudget, spent: context.spentMicrocents } };
  }

  // Check chain depth
  const actualDepth = chainDepth + token.blocks.length;
  const depthLimit = context.maxChainDepth ?? 10;
  if (actualDepth > depthLimit) {
    return { ok: false, error: { type: 'chain_depth_exceeded', max: depthLimit, actual: actualDepth } };
  }

  // Check capability match
  const requestedNamespace = context.namespace ?? '';
  const matched = capabilities.some(cap => {
    if (requestedNamespace && cap.namespace !== requestedNamespace && cap.namespace !== '*') return false;
    if (cap.action !== context.operation && cap.action !== '*') return false;
    if (cap.resource === '*' || cap.resource === '**') return true;
    return cap.resource === context.resource || matchGlob(cap.resource, context.resource);
  });

  if (!matched) {
    return {
      ok: false,
      error: {
        type: 'capability_not_granted',
        requested: { namespace: requestedNamespace || '*', action: context.operation, resource: context.resource },
        granted: capabilities,
      },
    };
  }

  return {
    ok: true,
    value: {
      capabilities,
      remainingBudgetMicrocents: maxBudget - context.spentMicrocents,
      chainDepth: actualDepth,
      maxChainDepth,
      contractId: lastContractId,
      delegationId: lastDelegationId,
    },
  };
}

// ── Factory ──

export type DCTFormat = 'sjt' | 'biscuit';

/** DCT engine interface returned by the factory */
export interface DCTEngine {
  createDCT: typeof createBiscuitDCT;
  attenuateDCT: typeof attenuateBiscuitDCT;
  verifyDCT: typeof verifyBiscuitDCT;
}

/**
 * Factory for selecting DCT backend (SJT or Biscuit).
 * Both backends implement the same interface for seamless switching.
 */
export class DCTEngineFactory {
  /**
   * Create a DCT engine for the given format.
   * @param format - 'sjt' for Signed JSON Tokens, 'biscuit' for Datalog-based tokens
   * @returns DCT engine with create, attenuate, and verify methods
   */
  static create(format: DCTFormat): DCTEngine {
    if (format === 'biscuit') {
      return {
        createDCT: createBiscuitDCT,
        attenuateDCT: attenuateBiscuitDCT,
        verifyDCT: verifyBiscuitDCT,
      };
    }
    return {
      createDCT: createSJTDCT,
      attenuateDCT: attenuateSJTDCT,
      verifyDCT: verifySJTDCT,
    };
  }
}

// ── Helpers ──

function serializeBiscuit(token: BiscuitToken): SerializedDCT {
  const json = canonicalize(token);
  const bytes = new TextEncoder().encode(json);
  return { token: toBase64url(bytes), format: 'delegateos-biscuit-v1' };
}

function deserializeBiscuit(serialized: SerializedDCT): BiscuitToken {
  if (serialized.format !== 'delegateos-biscuit-v1') {
    throw new Error(`Unsupported format: ${serialized.format}`);
  }
  const bytes = fromBase64url(serialized.token);
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as BiscuitToken;
}

function getFactValue(facts: Fact[], name: string): string | null {
  const fact = facts.find(f => f.name === name);
  return fact ? fact.terms[0] : null;
}

function getCapabilities(facts: Fact[]): Capability[] {
  return facts
    .filter(f => f.name === 'right' && f.terms.length === 3)
    .map(f => ({ namespace: f.terms[0], action: f.terms[1], resource: f.terms[2] }));
}

/** Delegate to the shared glob matcher from dct.ts for consistency */
function matchGlob(pattern: string, value: string): boolean {
  return matchGlobShared(pattern, value);
}
