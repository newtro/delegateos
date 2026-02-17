/**
 * Tests for A2A Protocol — Agent Registry and Delegation Broker.
 */

import { describe, it, expect } from 'vitest';
import { AgentRegistry } from '../src/a2a/registry.js';
import { DelegationBroker } from '../src/a2a/broker.js';
import { TrustEngine } from '../src/core/trust.js';
import { generateKeypair, signObject } from '../src/core/crypto.js';
import { createContract } from '../src/core/contract.js';
import type { AgentCard } from '../src/a2a/types.js';
import type { Keypair } from '../src/core/types.js';

/** Helper to create a signed agent card */
function createAgentCard(kp: Keypair, overrides: Partial<AgentCard> = {}): AgentCard {
  const card: AgentCard = {
    id: `agent_${kp.principal.id.slice(0, 8)}`,
    name: kp.principal.name ?? 'Agent',
    description: 'Test agent',
    principal: kp.principal.id,
    capabilities: [{ namespace: 'code', action: 'review', resource: '**' }],
    delegationPolicy: {
      acceptsDelegation: true,
      maxChainDepth: 5,
      requiredTrustScore: 0,
      allowedNamespaces: ['code'],
    },
    metadata: {},
    signature: '',
    ...overrides,
  };

  const { signature: _, ...toSign } = card;
  card.signature = signObject(kp.privateKey, toSign);
  return card;
}

describe('AgentRegistry', () => {
  it('registers and resolves a valid agent card', () => {
    const registry = new AgentRegistry();
    const kp = generateKeypair('Alice');
    const card = createAgentCard(kp);

    const result = registry.register(card);
    expect(result.ok).toBe(true);
    expect(registry.resolve(kp.principal.id)).toEqual(card);
  });

  it('rejects card with invalid signature', () => {
    const registry = new AgentRegistry();
    const kp = generateKeypair();
    const card = createAgentCard(kp);
    card.signature = 'invalid_sig';

    const result = registry.register(card);
    expect(result.ok).toBe(false);
  });

  it('rejects card signed by wrong key', () => {
    const registry = new AgentRegistry();
    const kp1 = generateKeypair();
    const kp2 = generateKeypair();
    const card = createAgentCard(kp1);
    // Re-sign with wrong key
    const { signature: _, ...toSign } = card;
    card.signature = signObject(kp2.privateKey, toSign);

    const result = registry.register(card);
    expect(result.ok).toBe(false);
  });

  it('discovers agents by capability', () => {
    const registry = new AgentRegistry();
    const kp1 = generateKeypair();
    const kp2 = generateKeypair();

    registry.register(createAgentCard(kp1, {
      capabilities: [{ namespace: 'code', action: 'review', resource: '**' }],
    }));
    registry.register(createAgentCard(kp2, {
      capabilities: [{ namespace: 'data', action: 'query', resource: '**' }],
    }));

    const codeAgents = registry.discover({
      capabilities: [{ namespace: 'code', action: 'review', resource: '**' }],
    });
    expect(codeAgents).toHaveLength(1);
    expect(codeAgents[0].principal).toBe(kp1.principal.id);
  });

  it('discovers agents by trust score', () => {
    const registry = new AgentRegistry();
    const kp1 = generateKeypair();
    const kp2 = generateKeypair();

    registry.register(createAgentCard(kp1, { trustScore: 0.9 }));
    registry.register(createAgentCard(kp2, { trustScore: 0.3 }));

    const highTrust = registry.discover({ minTrustScore: 0.5 });
    expect(highTrust).toHaveLength(1);
    expect(highTrust[0].principal).toBe(kp1.principal.id);
  });

  it('discovers agents by namespace', () => {
    const registry = new AgentRegistry();
    const kp1 = generateKeypair();
    const kp2 = generateKeypair();

    registry.register(createAgentCard(kp1, {
      capabilities: [{ namespace: 'code', action: '*', resource: '**' }],
      delegationPolicy: { acceptsDelegation: true, maxChainDepth: 5, requiredTrustScore: 0, allowedNamespaces: ['code'] },
    }));
    registry.register(createAgentCard(kp2, {
      capabilities: [{ namespace: 'data', action: '*', resource: '**' }],
      delegationPolicy: { acceptsDelegation: true, maxChainDepth: 5, requiredTrustScore: 0, allowedNamespaces: ['data'] },
    }));

    const codeAgents = registry.discover({ namespaces: ['code'] });
    expect(codeAgents).toHaveLength(1);
  });

  it('returns empty for no matches', () => {
    const registry = new AgentRegistry();
    expect(registry.discover({ minTrustScore: 0.99 })).toHaveLength(0);
  });

  it('unregisters an agent', () => {
    const registry = new AgentRegistry();
    const kp = generateKeypair();
    registry.register(createAgentCard(kp));
    expect(registry.resolve(kp.principal.id)).not.toBeNull();
    registry.unregister(kp.principal.id);
    expect(registry.resolve(kp.principal.id)).toBeNull();
  });

  it('listAll returns all registered cards', () => {
    const registry = new AgentRegistry();
    const kp1 = generateKeypair();
    const kp2 = generateKeypair();
    registry.register(createAgentCard(kp1));
    registry.register(createAgentCard(kp2));
    expect(registry.listAll()).toHaveLength(2);
  });

  it('verifyCard validates correct signature', () => {
    const registry = new AgentRegistry();
    const kp = generateKeypair();
    const card = createAgentCard(kp);
    const result = registry.verifyCard(card);
    expect(result.ok).toBe(true);
  });

  it('discovers with combined filters', () => {
    const registry = new AgentRegistry();
    const kp1 = generateKeypair();
    const kp2 = generateKeypair();

    registry.register(createAgentCard(kp1, {
      trustScore: 0.8,
      capabilities: [{ namespace: 'code', action: 'review', resource: '**' }],
    }));
    registry.register(createAgentCard(kp2, {
      trustScore: 0.9,
      capabilities: [{ namespace: 'data', action: 'query', resource: '**' }],
    }));

    const result = registry.discover({
      minTrustScore: 0.7,
      capabilities: [{ namespace: 'code', action: 'review', resource: '**' }],
    });
    expect(result).toHaveLength(1);
    expect(result[0].principal).toBe(kp1.principal.id);
  });
});

describe('DelegationBroker', () => {
  function setupBroker() {
    const registry = new AgentRegistry();
    const trustEngine = new TrustEngine();
    const broker = new DelegationBroker(registry, trustEngine);
    return { registry, trustEngine, broker };
  }

  it('finds an agent for a contract', () => {
    const { registry, broker } = setupBroker();
    const orchestrator = generateKeypair('Orchestrator');
    const agent = generateKeypair('Worker');

    registry.register(createAgentCard(agent, {
      capabilities: [{ namespace: 'code', action: '*', resource: '**' }],
    }));

    const contract = createContract(orchestrator, {
      title: 'Review PR',
      description: 'Review the pull request',
      inputs: {},
      outputSchema: { type: 'object' },
    }, {
      method: 'schema_match',
      schema: { type: 'object' },
    }, {
      maxBudgetMicrocents: 100_000,
      deadline: new Date(Date.now() + 3600_000).toISOString(),
      maxChainDepth: 3,
      requiredCapabilities: ['code'],
    });

    const result = broker.findAgent(contract);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.principal).toBe(agent.principal.id);
    }
  });

  it('returns error when no agents match', () => {
    const { broker } = setupBroker();
    const kp = generateKeypair();
    const contract = createContract(kp, {
      title: 'Task',
      description: 'Desc',
      inputs: {},
      outputSchema: { type: 'object' },
    }, { method: 'schema_match', schema: { type: 'object' } }, {
      maxBudgetMicrocents: 100_000,
      deadline: new Date(Date.now() + 3600_000).toISOString(),
      maxChainDepth: 3,
      requiredCapabilities: ['nonexistent'],
    });

    const result = broker.findAgent(contract);
    expect(result.ok).toBe(false);
  });

  it('proposes a delegation', () => {
    const { registry, broker } = setupBroker();
    const orchestrator = generateKeypair('Orchestrator');
    const agent = generateKeypair('Worker');

    const card = createAgentCard(agent);
    registry.register(card);

    const contract = createContract(orchestrator, {
      title: 'Task',
      description: 'Desc',
      inputs: {},
      outputSchema: { type: 'object' },
    }, { method: 'schema_match', schema: { type: 'object' } }, {
      maxBudgetMicrocents: 100_000,
      deadline: new Date(Date.now() + 3600_000).toISOString(),
      maxChainDepth: 3,
      requiredCapabilities: ['code'],
    });

    const result = broker.proposeDelegation(orchestrator, card, contract);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.delegation.from).toBe(orchestrator.principal.id);
      expect(result.value.delegation.to).toBe(agent.principal.id);
      expect(result.value.delegation.status).toBe('active');
      expect(result.value.dct.format).toBe('delegateos-sjt-v1');
    }
  });

  it('rejects delegation to agent that does not accept', () => {
    const { registry, broker } = setupBroker();
    const orchestrator = generateKeypair();
    const agent = generateKeypair();

    const card = createAgentCard(agent, {
      delegationPolicy: { acceptsDelegation: false, maxChainDepth: 5, requiredTrustScore: 0, allowedNamespaces: ['code'] },
    });
    registry.register(card);

    const contract = createContract(orchestrator, {
      title: 'Task', description: 'D', inputs: {}, outputSchema: {},
    }, { method: 'schema_match', schema: {} }, {
      maxBudgetMicrocents: 100_000, deadline: new Date(Date.now() + 3600_000).toISOString(),
      maxChainDepth: 3, requiredCapabilities: [],
    });

    const result = broker.proposeDelegation(orchestrator, card, contract);
    expect(result.ok).toBe(false);
  });

  it('accepts a delegation and returns attestation', () => {
    const { registry, broker } = setupBroker();
    const orchestrator = generateKeypair();
    const agent = generateKeypair();

    const card = createAgentCard(agent);
    registry.register(card);

    const contract = createContract(orchestrator, {
      title: 'Task', description: 'D', inputs: {}, outputSchema: {},
    }, { method: 'schema_match', schema: {} }, {
      maxBudgetMicrocents: 100_000, deadline: new Date(Date.now() + 3600_000).toISOString(),
      maxChainDepth: 3, requiredCapabilities: [],
    });

    const propResult = broker.proposeDelegation(orchestrator, card, contract);
    expect(propResult.ok).toBe(true);
    if (!propResult.ok) return;

    const acceptResult = broker.acceptDelegation(agent, propResult.value.delegation, {
      success: true,
      output: { result: 'done' },
      costMicrocents: 5000,
      durationMs: 1000,
    });

    expect(acceptResult.ok).toBe(true);
    if (acceptResult.ok) {
      expect(acceptResult.value.principal).toBe(agent.principal.id);
      expect(acceptResult.value.result.success).toBe(true);
    }
  });

  it('rejects accept from wrong agent', () => {
    const { registry, broker } = setupBroker();
    const orchestrator = generateKeypair();
    const agent = generateKeypair();
    const imposter = generateKeypair();

    const card = createAgentCard(agent);
    registry.register(card);

    const contract = createContract(orchestrator, {
      title: 'T', description: 'D', inputs: {}, outputSchema: {},
    }, { method: 'schema_match', schema: {} }, {
      maxBudgetMicrocents: 100_000, deadline: new Date(Date.now() + 3600_000).toISOString(),
      maxChainDepth: 3, requiredCapabilities: [],
    });

    const propResult = broker.proposeDelegation(orchestrator, card, contract);
    if (!propResult.ok) return;

    const result = broker.acceptDelegation(imposter, propResult.value.delegation, {
      success: true, costMicrocents: 0, durationMs: 0,
    });
    expect(result.ok).toBe(false);
  });

  it('filters agents by cost', () => {
    const { registry, broker } = setupBroker();
    const orchestrator = generateKeypair();
    const expensive = generateKeypair();
    const cheap = generateKeypair();

    registry.register(createAgentCard(expensive, {
      delegationPolicy: {
        acceptsDelegation: true, maxChainDepth: 5, requiredTrustScore: 0,
        allowedNamespaces: ['code'], costPerTaskMicrocents: 999_999,
      },
    }));
    registry.register(createAgentCard(cheap, {
      delegationPolicy: {
        acceptsDelegation: true, maxChainDepth: 5, requiredTrustScore: 0,
        allowedNamespaces: ['code'], costPerTaskMicrocents: 1000,
      },
    }));

    const contract = createContract(orchestrator, {
      title: 'T', description: 'D', inputs: {}, outputSchema: {},
    }, { method: 'schema_match', schema: {} }, {
      maxBudgetMicrocents: 50_000, deadline: new Date(Date.now() + 3600_000).toISOString(),
      maxChainDepth: 3, requiredCapabilities: [],
    });

    const result = broker.findAgent(contract);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.principal).toBe(cheap.principal.id);
    }
  });
});
