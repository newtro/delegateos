/**
 * Integration tests — Full delegation lifecycle with 3+ agents.
 */

import { describe, it, expect } from 'vitest';
import { generateKeypair, signObject } from '../../src/core/crypto.js';
import { createDCT, attenuateDCT, verifyDCT, inspectDCT, getRevocationIds } from '../../src/core/dct.js';
import { createContract } from '../../src/core/contract.js';
import { createCompletionAttestation, verifyAttestationSignature } from '../../src/core/attestation.js';
import { InMemoryRevocationList, createRevocationEntry } from '../../src/core/revocation.js';
import { generateDelegationId } from '../../src/core/chain.js';
import { TrustEngine } from '../../src/core/trust.js';
import { decompose, ParallelStrategy } from '../../src/core/decomposition.js';
import { AgentRegistry } from '../../src/a2a/registry.js';
import { DelegationBroker } from '../../src/a2a/broker.js';
import type { AgentCard } from '../../src/a2a/types.js';
import type { Keypair, Delegation, VerificationContext } from '../../src/core/types.js';

function futureISO(hours = 1): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

function makeContract(keys: Keypair, id?: string) {
  return createContract(
    keys,
    { title: 'PR Review', description: 'Review code', inputs: {}, outputSchema: { type: 'object' } },
    { method: 'schema_match', schema: { type: 'object' } },
    { maxBudgetMicrocents: 9000, deadline: futureISO(2), maxChainDepth: 3, requiredCapabilities: ['code'] },
  );
}

function createAgentCard(kp: Keypair, overrides: Partial<AgentCard> = {}): AgentCard {
  const card: AgentCard = {
    id: `agent_${kp.principal.id.slice(0, 8)}`,
    name: kp.principal.name ?? 'Agent',
    description: 'Test agent',
    principal: kp.principal.id,
    capabilities: [{ namespace: 'code', action: '*', resource: '**' }],
    delegationPolicy: { acceptsDelegation: true, maxChainDepth: 5, requiredTrustScore: 0, allowedNamespaces: ['code'] },
    metadata: {},
    signature: '',
    ...overrides,
  };
  const { signature: _, ...toSign } = card;
  card.signature = signObject(kp.privateKey, toSign);
  return card;
}

function makeAttestation(keys: Keypair, contractId: string, delegationId: string, success = true) {
  return createCompletionAttestation(keys, contractId, delegationId, {
    success,
    output: { reviewed: true },
    costMicrocents: 500,
    durationMs: 1000,
  });
}

describe('Full Delegation Flow', () => {
  const orchestratorKeys = generateKeypair('Orchestrator');
  const securityKeys = generateKeypair('SecurityBot');
  const blazorKeys = generateKeypair('BlazorExpert');
  const dbKeys = generateKeypair('DBAnalyzer');

  const trustEngine = new TrustEngine();
  const registry = new AgentRegistry();
  const broker = new DelegationBroker(registry, trustEngine);

  registry.register(createAgentCard(securityKeys, { name: 'SecurityBot' }));
  registry.register(createAgentCard(blazorKeys, { name: 'BlazorExpert' }));
  registry.register(createAgentCard(dbKeys, { name: 'DBAnalyzer' }));

  it('orchestrator creates contract and decomposes into sub-tasks', () => {
    const contract = makeContract(orchestratorKeys);
    expect(contract.id).toBeDefined();
    const plan = decompose(contract, new ParallelStrategy([
      { title: 'Security Review', description: 'Check security', capabilities: [{ namespace: 'code', action: 'review', resource: '**' }], budgetFraction: 0.33 },
      { title: 'UI Review', description: 'Check UI', capabilities: [{ namespace: 'code', action: 'review', resource: '**' }], budgetFraction: 0.33 },
      { title: 'DB Review', description: 'Check DB', capabilities: [{ namespace: 'code', action: 'review', resource: '**' }], budgetFraction: 0.34 },
    ]));
    expect(plan.subTasks.length).toBeGreaterThan(0);
    expect(plan.parentContractId).toBe(contract.id);
  });

  it('full chain: orchestrator → 3 specialists → attestations → trust update', () => {
    const contract = makeContract(orchestratorKeys);
    const agents = [securityKeys, blazorKeys, dbKeys];
    const delegations: Delegation[] = [];

    for (const agentKeys of agents) {
      const delegationId = generateDelegationId();
      const dct = createDCT({
        issuer: orchestratorKeys,
        delegatee: agentKeys.principal,
        capabilities: [{ namespace: 'code', action: 'review', resource: '**' }],
        contractId: contract.id,
        delegationId,
        parentDelegationId: 'del_root',
        chainDepth: 0,
        maxChainDepth: 3,
        maxBudgetMicrocents: 3000,
        expiresAt: futureISO(1),
      });

      const ctx: VerificationContext = {
        resource: '**', namespace: 'code', operation: 'review',
        now: new Date().toISOString(), spentMicrocents: 0, rootPublicKey: orchestratorKeys.principal.id,
      };
      expect(verifyDCT(dct, ctx).ok).toBe(true);

      const delegation: Delegation = {
        id: delegationId, parentId: 'del_root', from: orchestratorKeys.principal.id,
        to: agentKeys.principal.id, contractId: contract.id, dct, depth: 0, status: 'active',
        createdAt: new Date().toISOString(),
      };
      delegations.push(delegation);

      const attestation = makeAttestation(agentKeys, contract.id, delegationId);
      expect(verifyAttestationSignature(attestation, agentKeys.principal.id)).toBe(true);
      trustEngine.recordOutcome(agentKeys.principal.id, attestation);
    }

    expect(delegations).toHaveLength(3);
    for (const agentKeys of agents) {
      const score = trustEngine.getScore(agentKeys.principal.id);
      expect(score.composite).toBeGreaterThan(0.5);
    }
  });

  it('budget constraints cascade correctly through chain', () => {
    const contract = makeContract(orchestratorKeys);

    const rootDCT = createDCT({
      issuer: orchestratorKeys, delegatee: securityKeys.principal,
      capabilities: [{ namespace: 'code', action: '*', resource: '**' }],
      contractId: contract.id, delegationId: 'del_cascade_1', parentDelegationId: 'del_root',
      chainDepth: 0, maxChainDepth: 3, maxBudgetMicrocents: 10000, expiresAt: futureISO(1),
    });

    const childDCT = attenuateDCT({
      token: rootDCT, attenuator: securityKeys, delegatee: blazorKeys.principal,
      delegationId: 'del_cascade_2', contractId: contract.id, maxBudgetMicrocents: 5000,
    });

    const ctx: VerificationContext = {
      resource: '**', namespace: 'code', operation: '*',
      now: new Date().toISOString(), spentMicrocents: 4000, rootPublicKey: orchestratorKeys.principal.id,
    };
    expect(verifyDCT(childDCT, ctx).ok).toBe(true);

    expect(verifyDCT(childDCT, { ...ctx, spentMicrocents: 6000 }).ok).toBe(false);
  });

  it('capability attenuation through chain', () => {
    const contract = makeContract(orchestratorKeys);

    const rootDCT = createDCT({
      issuer: orchestratorKeys, delegatee: securityKeys.principal,
      capabilities: [
        { namespace: 'code', action: 'read', resource: '**' },
        { namespace: 'code', action: 'write', resource: '/src/**' },
      ],
      contractId: contract.id, delegationId: 'del_cap_1', parentDelegationId: 'del_root',
      chainDepth: 0, maxChainDepth: 3, maxBudgetMicrocents: 5000, expiresAt: futureISO(1),
    });

    const readOnlyDCT = attenuateDCT({
      token: rootDCT, attenuator: securityKeys, delegatee: blazorKeys.principal,
      delegationId: 'del_cap_2', contractId: contract.id,
      allowedCapabilities: [{ namespace: 'code', action: 'read', resource: '**' }],
    });

    const readCtx: VerificationContext = {
      resource: '/src/main.ts', namespace: 'code', operation: 'read',
      now: new Date().toISOString(), spentMicrocents: 0, rootPublicKey: orchestratorKeys.principal.id,
    };
    expect(verifyDCT(readOnlyDCT, readCtx).ok).toBe(true);
    expect(verifyDCT(readOnlyDCT, { ...readCtx, operation: 'write' }).ok).toBe(false);
  });

  it('revocation mid-chain cancels downstream', () => {
    const contract = makeContract(orchestratorKeys);
    const chainRevocations = new InMemoryRevocationList();

    const rootDCT = createDCT({
      issuer: orchestratorKeys, delegatee: securityKeys.principal,
      capabilities: [{ namespace: 'code', action: '*', resource: '**' }],
      contractId: contract.id, delegationId: 'del_rev_1', parentDelegationId: 'del_root',
      chainDepth: 0, maxChainDepth: 3, maxBudgetMicrocents: 5000, expiresAt: futureISO(1),
    });

    const childDCT = attenuateDCT({
      token: rootDCT, attenuator: securityKeys, delegatee: blazorKeys.principal,
      delegationId: 'del_rev_2', contractId: contract.id,
    });

    const ctx: VerificationContext = {
      resource: '**', namespace: 'code', operation: '*',
      now: new Date().toISOString(), spentMicrocents: 0, rootPublicKey: orchestratorKeys.principal.id,
    };
    expect(verifyDCT(rootDCT, ctx).ok).toBe(true);
    expect(verifyDCT(childDCT, ctx).ok).toBe(true);

    const revocationIds = getRevocationIds(rootDCT);
    expect(revocationIds.length).toBeGreaterThan(0);
    const revEntry = createRevocationEntry(orchestratorKeys, revocationIds[0], 'chain');
    chainRevocations.add(revEntry);

    const revokedCtx: VerificationContext = { ...ctx, revocationIds: chainRevocations.getRevocationIds() };
    expect(verifyDCT(rootDCT, revokedCtx).ok).toBe(false);
    expect(verifyDCT(childDCT, revokedCtx).ok).toBe(false);
  });

  it('broker discovers agents and proposes delegation', () => {
    const contract = makeContract(orchestratorKeys);
    const agentResult = broker.findAgent(contract);
    expect(agentResult.ok).toBe(true);
    if (!agentResult.ok) return;
    const proposalResult = broker.proposeDelegation(orchestratorKeys, agentResult.value, contract);
    expect(proposalResult.ok).toBe(true);
    if (!proposalResult.ok) return;
    expect(proposalResult.value.dct).toBeDefined();
    expect(proposalResult.value.delegation.status).toBe('active');
  });

  it('broker accepts delegation and produces attestation', () => {
    const contract = makeContract(orchestratorKeys);
    const agentResult = broker.findAgent(contract);
    expect(agentResult.ok).toBe(true);
    if (!agentResult.ok) return;
    const target = agentResult.value;
    const proposalResult = broker.proposeDelegation(orchestratorKeys, target, contract);
    expect(proposalResult.ok).toBe(true);
    if (!proposalResult.ok) return;

    const targetKeys = [securityKeys, blazorKeys, dbKeys].find(k => k.principal.id === target.principal)!;
    const acceptResult = broker.acceptDelegation(targetKeys, proposalResult.value.delegation, {
      success: true, output: { reviewed: true }, costMicrocents: 200, durationMs: 500,
    });
    expect(acceptResult.ok).toBe(true);
    if (!acceptResult.ok) return;
    expect(acceptResult.value.type).toBe('completion');
  });

  it('handles 3-level delegation chain end to end', () => {
    const contract = makeContract(orchestratorKeys);

    const dct0 = createDCT({
      issuer: orchestratorKeys, delegatee: securityKeys.principal,
      capabilities: [{ namespace: 'code', action: '*', resource: '**' }],
      contractId: contract.id, delegationId: 'del_chain_0', parentDelegationId: 'del_root',
      chainDepth: 0, maxChainDepth: 3, maxBudgetMicrocents: 9000, expiresAt: futureISO(1),
    });
    const dct1 = attenuateDCT({
      token: dct0, attenuator: securityKeys, delegatee: blazorKeys.principal,
      delegationId: 'del_chain_1', contractId: contract.id, maxBudgetMicrocents: 6000,
    });
    const dct2 = attenuateDCT({
      token: dct1, attenuator: blazorKeys, delegatee: dbKeys.principal,
      delegationId: 'del_chain_2', contractId: contract.id, maxBudgetMicrocents: 3000,
    });

    const ctx: VerificationContext = {
      resource: '**', namespace: 'code', operation: '*',
      now: new Date().toISOString(), spentMicrocents: 0, rootPublicKey: orchestratorKeys.principal.id,
    };
    expect(verifyDCT(dct0, ctx).ok).toBe(true);
    expect(verifyDCT(dct1, ctx).ok).toBe(true);
    expect(verifyDCT(dct2, ctx).ok).toBe(true);

    const dbAtt = makeAttestation(dbKeys, contract.id, 'del_chain_2');
    const blazorAtt = makeAttestation(blazorKeys, contract.id, 'del_chain_1');
    const secAtt = makeAttestation(securityKeys, contract.id, 'del_chain_0');

    expect(verifyAttestationSignature(dbAtt, dbKeys.principal.id)).toBe(true);
    expect(verifyAttestationSignature(blazorAtt, blazorKeys.principal.id)).toBe(true);
    expect(verifyAttestationSignature(secAtt, securityKeys.principal.id)).toBe(true);
  });
});
