import { describe, it, expect } from 'vitest';
import { generateKeypair } from '../src/core/crypto.js';
import {
  createContract,
  verifyContractSignature,
  verifyOutput,
  createDefaultRegistry,
  CheckFunctionRegistry,
} from '../src/core/contract.js';
import type { TaskSpec, TaskConstraints, VerificationSpec } from '../src/core/types.js';

const issuer = generateKeypair('issuer');
const registry = createDefaultRegistry();

const task: TaskSpec = {
  title: 'Test Task',
  description: 'A test task',
  inputs: { query: 'test' },
  outputSchema: { type: 'object', properties: { result: { type: 'string' } } },
};

const constraints: TaskConstraints = {
  maxBudgetMicrocents: 1000000,
  deadline: new Date(Date.now() + 3600_000).toISOString(),
  maxChainDepth: 3,
  requiredCapabilities: ['web:search'],
};

describe('Contract', () => {
  it('should create and verify a contract signature', () => {
    const contract = createContract(issuer, task, { method: 'schema_match', schema: task.outputSchema }, constraints);
    expect(contract.id).toMatch(/^ct_/);
    expect(contract.version).toBe('0.1');
    expect(verifyContractSignature(contract, issuer.principal.id)).toBe(true);
  });

  it('should reject tampered contract', () => {
    const contract = createContract(issuer, task, { method: 'schema_match', schema: task.outputSchema }, constraints);
    contract.task.title = 'Tampered';
    expect(verifyContractSignature(contract, issuer.principal.id)).toBe(false);
  });

  it('should reject wrong issuer key', () => {
    const other = generateKeypair('other');
    const contract = createContract(issuer, task, { method: 'schema_match', schema: task.outputSchema }, constraints);
    expect(verifyContractSignature(contract, other.principal.id)).toBe(false);
  });
});

describe('Verification: schema_match', () => {
  it('should pass valid output', () => {
    const contract = createContract(issuer, task, {
      method: 'schema_match',
      schema: { type: 'object', properties: { result: { type: 'string' } }, required: ['result'] },
    }, constraints);
    const result = verifyOutput(contract, { result: 'hello' }, registry);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.passed).toBe(true);
  });

  it('should fail invalid output', () => {
    const contract = createContract(issuer, task, {
      method: 'schema_match',
      schema: { type: 'object', properties: { result: { type: 'string' } }, required: ['result'] },
    }, constraints);
    const result = verifyOutput(contract, { result: 123 }, registry);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.passed).toBe(false);
  });
});

describe('Verification: deterministic_check', () => {
  it('regex_match should pass', () => {
    const contract = createContract(issuer, task, {
      method: 'deterministic_check',
      checkName: 'regex_match',
      checkParams: { pattern: '^hello' },
    }, constraints);
    const result = verifyOutput(contract, 'hello world', registry);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.passed).toBe(true);
  });

  it('regex_match should fail', () => {
    const contract = createContract(issuer, task, {
      method: 'deterministic_check',
      checkName: 'regex_match',
      checkParams: { pattern: '^hello' },
    }, constraints);
    const result = verifyOutput(contract, 'world hello', registry);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.passed).toBe(false);
  });

  it('string_length should check bounds', () => {
    const contract = createContract(issuer, task, {
      method: 'deterministic_check',
      checkName: 'string_length',
      checkParams: { min: 3, max: 10 },
    }, constraints);
    expect(verifyOutput(contract, 'hello', registry).ok && (verifyOutput(contract, 'hello', registry) as { ok: true; value: { passed: boolean } }).value.passed).toBe(true);
    const short = verifyOutput(contract, 'hi', registry);
    expect(short.ok).toBe(true);
    if (short.ok) expect(short.value.passed).toBe(false);
  });

  it('array_length should check bounds', () => {
    const contract = createContract(issuer, task, {
      method: 'deterministic_check',
      checkName: 'array_length',
      checkParams: { min: 2, max: 5 },
    }, constraints);
    const result = verifyOutput(contract, [1, 2, 3], registry);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.passed).toBe(true);
  });

  it('field_exists should check fields', () => {
    const contract = createContract(issuer, task, {
      method: 'deterministic_check',
      checkName: 'field_exists',
      checkParams: { fields: ['name', 'nested.value'] },
    }, constraints);
    const pass = verifyOutput(contract, { name: 'test', nested: { value: 42 } }, registry);
    expect(pass.ok).toBe(true);
    if (pass.ok) expect(pass.value.passed).toBe(true);

    const fail = verifyOutput(contract, { name: 'test' }, registry);
    expect(fail.ok).toBe(true);
    if (fail.ok) expect(fail.value.passed).toBe(false);
  });

  it('exit_code should check exit code', () => {
    const contract = createContract(issuer, task, {
      method: 'deterministic_check',
      checkName: 'exit_code',
      checkParams: { expected: 0 },
    }, constraints);
    const pass = verifyOutput(contract, { exitCode: 0 }, registry);
    expect(pass.ok).toBe(true);
    if (pass.ok) expect(pass.value.passed).toBe(true);

    const fail = verifyOutput(contract, { exitCode: 1 }, registry);
    expect(fail.ok).toBe(true);
    if (fail.ok) expect(fail.value.passed).toBe(false);
  });

  it('output_equals should deep compare', () => {
    const contract = createContract(issuer, task, {
      method: 'deterministic_check',
      checkName: 'output_equals',
      checkParams: { expected: { a: 1, b: 2 } },
    }, constraints);
    const pass = verifyOutput(contract, { a: 1, b: 2 }, registry);
    expect(pass.ok).toBe(true);
    if (pass.ok) expect(pass.value.passed).toBe(true);

    const fail = verifyOutput(contract, { a: 1, b: 3 }, registry);
    expect(fail.ok).toBe(true);
    if (fail.ok) expect(fail.value.passed).toBe(false);
  });
});

describe('Verification: composite', () => {
  it('all_pass should require all steps', () => {
    const contract = createContract(issuer, task, {
      method: 'composite',
      mode: 'all_pass',
      steps: [
        { method: 'deterministic_check', checkName: 'field_exists', checkParams: { fields: ['name'] } },
        { method: 'deterministic_check', checkName: 'string_length', checkParams: { min: 1, field: 'name' } },
      ],
    }, constraints);
    const pass = verifyOutput(contract, { name: 'hello' }, registry);
    expect(pass.ok).toBe(true);
    if (pass.ok) expect(pass.value.passed).toBe(true);
  });

  it('all_pass should short-circuit on failure', () => {
    const contract = createContract(issuer, task, {
      method: 'composite',
      mode: 'all_pass',
      steps: [
        { method: 'deterministic_check', checkName: 'field_exists', checkParams: { fields: ['missing'] } },
        { method: 'deterministic_check', checkName: 'string_length', checkParams: { min: 1, field: 'name' } },
      ],
    }, constraints);
    const result = verifyOutput(contract, { name: 'hello' }, registry);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.passed).toBe(false);
  });

  it('majority should pass with >50%', () => {
    const contract = createContract(issuer, task, {
      method: 'composite',
      mode: 'majority',
      steps: [
        { method: 'deterministic_check', checkName: 'field_exists', checkParams: { fields: ['name'] } },
        { method: 'deterministic_check', checkName: 'field_exists', checkParams: { fields: ['missing'] } },
        { method: 'deterministic_check', checkName: 'field_exists', checkParams: { fields: ['name'] } },
      ],
    }, constraints);
    const result = verifyOutput(contract, { name: 'hello' }, registry);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.passed).toBe(true);
  });

  it('weighted should use threshold', () => {
    const contract = createContract(issuer, task, {
      method: 'composite',
      mode: 'weighted',
      weights: [0.8, 0.2],
      passThreshold: 0.7,
      steps: [
        { method: 'deterministic_check', checkName: 'field_exists', checkParams: { fields: ['name'] } },
        { method: 'deterministic_check', checkName: 'field_exists', checkParams: { fields: ['missing'] } },
      ],
    }, constraints);
    const result = verifyOutput(contract, { name: 'hello' }, registry);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.passed).toBe(true);
  });
});

describe('CheckFunctionRegistry', () => {
  it('should register and retrieve custom functions', () => {
    const reg = new CheckFunctionRegistry();
    reg.register('custom', () => ({ passed: true, score: 1 }));
    expect(reg.list()).toContain('custom');
    expect(reg.get('custom')('anything').passed).toBe(true);
  });

  it('should throw on missing function', () => {
    const reg = new CheckFunctionRegistry();
    expect(() => reg.get('nope')).toThrow();
  });

  it('should have all built-ins in default registry', () => {
    const names = registry.list();
    expect(names).toContain('regex_match');
    expect(names).toContain('json_schema');
    expect(names).toContain('string_length');
    expect(names).toContain('array_length');
    expect(names).toContain('field_exists');
    expect(names).toContain('exit_code');
    expect(names).toContain('output_equals');
  });
});
