import { describe, it, expect } from 'vitest';
import { decompose, validatePlan, SequentialStrategy, ParallelStrategy } from '../src/core/decomposition.js';
import type { TaskContract, DecompositionPlan } from '../src/core/types.js';

function makeContract(overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    id: 'ct_test',
    version: '0.1',
    issuer: 'issuer_key',
    createdAt: new Date().toISOString(),
    task: {
      title: 'Test task',
      description: 'A test',
      inputs: {},
      outputSchema: { type: 'object' },
    },
    verification: { method: 'schema_match', schema: { type: 'object' } },
    constraints: {
      maxBudgetMicrocents: 1_000_000,
      deadline: new Date(Date.now() + 3600_000).toISOString(),
      maxChainDepth: 5,
      requiredCapabilities: ['web', 'docs'],
    },
    signature: 'sig',
    ...overrides,
  };
}

describe('Decomposition', () => {
  describe('SequentialStrategy', () => {
    it('creates sequential sub-tasks with dependencies', () => {
      const strategy = new SequentialStrategy([
        { title: 'Step 1', description: 'First', capabilities: [{ namespace: 'web', action: 'search', resource: '*' }], budgetFraction: 0.3 },
        { title: 'Step 2', description: 'Second', capabilities: [{ namespace: 'docs', action: 'read', resource: '*' }], budgetFraction: 0.7 },
      ]);
      const contract = makeContract();
      const plan = decompose(contract, strategy);

      expect(plan.subTasks).toHaveLength(2);
      expect(plan.subTasks[0].dependsOn).toHaveLength(0);
      expect(plan.subTasks[1].dependsOn).toEqual([plan.subTasks[0].id]);
      expect(plan.strategy).toBe('sequential');
      expect(plan.parentContractId).toBe('ct_test');
    });

    it('allocates budget fractions correctly', () => {
      const strategy = new SequentialStrategy([
        { title: 'A', description: '', capabilities: [], budgetFraction: 0.4 },
        { title: 'B', description: '', capabilities: [], budgetFraction: 0.6 },
      ]);
      const plan = decompose(makeContract(), strategy);
      expect(plan.subTasks[0].budgetMicrocents).toBe(400_000);
      expect(plan.subTasks[1].budgetMicrocents).toBe(600_000);
    });
  });

  describe('ParallelStrategy', () => {
    it('creates parallel sub-tasks with no dependencies', () => {
      const strategy = new ParallelStrategy([
        { title: 'A', description: '', capabilities: [], budgetFraction: 0.5 },
        { title: 'B', description: '', capabilities: [], budgetFraction: 0.5 },
      ]);
      const plan = decompose(makeContract(), strategy);

      expect(plan.subTasks).toHaveLength(2);
      expect(plan.subTasks[0].dependsOn).toHaveLength(0);
      expect(plan.subTasks[1].dependsOn).toHaveLength(0);
      expect(plan.strategy).toBe('parallel');
    });
  });

  describe('validatePlan', () => {
    it('passes for valid plan', () => {
      const strategy = new ParallelStrategy([
        { title: 'A', description: '', capabilities: [{ namespace: 'web', action: 'search', resource: '*' }], budgetFraction: 0.5 },
        { title: 'B', description: '', capabilities: [{ namespace: 'docs', action: 'read', resource: '*' }], budgetFraction: 0.5 },
      ]);
      const contract = makeContract();
      const plan = decompose(contract, strategy);
      const result = validatePlan(plan, contract);
      expect(result.ok).toBe(true);
    });

    it('fails when budget exceeds parent', () => {
      const strategy = new ParallelStrategy([
        { title: 'A', description: '', capabilities: [], budgetFraction: 0.6 },
        { title: 'B', description: '', capabilities: [], budgetFraction: 0.6 },
      ]);
      const contract = makeContract();
      const plan = decompose(contract, strategy);
      const result = validatePlan(plan, contract);
      expect(result.ok).toBe(false);
    });

    it('fails when deadline exceeds parent', () => {
      const contract = makeContract();
      const plan: DecompositionPlan = {
        id: 'plan_test',
        parentContractId: contract.id,
        strategy: 'test',
        subTasks: [{
          id: 'st_1',
          title: 'Late',
          description: '',
          capabilities: [],
          budgetMicrocents: 100,
          deadline: new Date(Date.now() + 7200_000).toISOString(), // 2h, parent is 1h
          dependsOn: [],
        }],
        createdAt: new Date().toISOString(),
      };
      const result = validatePlan(plan, contract);
      expect(result.ok).toBe(false);
    });

    it('fails for unknown capability namespace', () => {
      const contract = makeContract();
      const plan: DecompositionPlan = {
        id: 'plan_test',
        parentContractId: contract.id,
        strategy: 'test',
        subTasks: [{
          id: 'st_1',
          title: 'Bad cap',
          description: '',
          capabilities: [{ namespace: 'forbidden', action: 'x', resource: '*' }],
          budgetMicrocents: 100,
          deadline: contract.constraints.deadline,
          dependsOn: [],
        }],
        createdAt: new Date().toISOString(),
      };
      const result = validatePlan(plan, contract);
      expect(result.ok).toBe(false);
    });

    it('fails for unknown dependency', () => {
      const contract = makeContract();
      const plan: DecompositionPlan = {
        id: 'plan_test',
        parentContractId: contract.id,
        strategy: 'test',
        subTasks: [{
          id: 'st_1',
          title: 'Orphan dep',
          description: '',
          capabilities: [],
          budgetMicrocents: 100,
          deadline: contract.constraints.deadline,
          dependsOn: ['nonexistent'],
        }],
        createdAt: new Date().toISOString(),
      };
      const result = validatePlan(plan, contract);
      expect(result.ok).toBe(false);
    });

    it('fails for self-dependency', () => {
      const contract = makeContract();
      const plan: DecompositionPlan = {
        id: 'plan_test',
        parentContractId: contract.id,
        strategy: 'test',
        subTasks: [{
          id: 'st_1',
          title: 'Self',
          description: '',
          capabilities: [],
          budgetMicrocents: 100,
          deadline: contract.constraints.deadline,
          dependsOn: ['st_1'],
        }],
        createdAt: new Date().toISOString(),
      };
      const result = validatePlan(plan, contract);
      expect(result.ok).toBe(false);
    });

    it('fails for dependency cycle', () => {
      const contract = makeContract();
      const plan: DecompositionPlan = {
        id: 'plan_test',
        parentContractId: contract.id,
        strategy: 'test',
        subTasks: [
          { id: 'st_a', title: 'A', description: '', capabilities: [], budgetMicrocents: 100, deadline: contract.constraints.deadline, dependsOn: ['st_b'] },
          { id: 'st_b', title: 'B', description: '', capabilities: [], budgetMicrocents: 100, deadline: contract.constraints.deadline, dependsOn: ['st_a'] },
        ],
        createdAt: new Date().toISOString(),
      };
      const result = validatePlan(plan, contract);
      expect(result.ok).toBe(false);
    });
  });
});
