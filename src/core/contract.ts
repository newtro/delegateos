/**
 * Task Contracts — Creation, signing, verification.
 */

import Ajv from 'ajv';
import type {
  TaskContract,
  TaskSpec,
  TaskConstraints,
  VerificationSpec,
  CheckResult,
  CheckFunction,
  Keypair,
  Result,
} from './types.js';
import { signObject, verifyObjectSignature, canonicalize } from './crypto.js';

const ajv = new Ajv({ strict: false });

// ── Check Function Registry ──

/** Registry for check functions used in deterministic verification */
export class CheckFunctionRegistry {
  private fns: Map<string, CheckFunction> = new Map();

  /** Register a check function */
  register(name: string, fn: CheckFunction): void {
    this.fns.set(name, fn);
  }

  /** Get a registered function (throws if not found) */
  get(name: string): CheckFunction {
    const fn = this.fns.get(name);
    if (!fn) throw new Error(`Check function not found: ${name}`);
    return fn;
  }

  /** List all registered function names */
  list(): string[] {
    return Array.from(this.fns.keys());
  }
}

// ── Built-in Check Functions ──

function getField(output: unknown, field?: string): unknown {
  if (!field) return output;
  const parts = field.split('.');
  let current: unknown = output;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

const builtinChecks: Record<string, CheckFunction> = {
  regex_match(output: unknown, params?: unknown): CheckResult {
    const p = params as { pattern: string; flags?: string; field?: string };
    const value = getField(output, p.field);
    if (typeof value !== 'string') {
      return { passed: false, score: 0, details: 'Value is not a string' };
    }
    const regex = new RegExp(p.pattern, p.flags);
    const match = regex.test(value);
    return { passed: match, score: match ? 1 : 0 };
  },

  json_schema(output: unknown, params?: unknown): CheckResult {
    const p = params as { schema: Record<string, unknown> };
    const validate = ajv.compile(p.schema);
    const valid = validate(output);
    return {
      passed: valid as boolean,
      score: valid ? 1 : 0,
      details: valid ? undefined : ajv.errorsText(validate.errors),
    };
  },

  string_length(output: unknown, params?: unknown): CheckResult {
    const p = params as { min?: number; max?: number; field?: string };
    const value = getField(output, p.field);
    if (typeof value !== 'string') {
      return { passed: false, score: 0, details: 'Value is not a string' };
    }
    const len = value.length;
    const minOk = p.min === undefined || len >= p.min;
    const maxOk = p.max === undefined || len <= p.max;
    const passed = minOk && maxOk;
    return { passed, score: passed ? 1 : 0, details: passed ? undefined : `Length ${len} out of bounds` };
  },

  array_length(output: unknown, params?: unknown): CheckResult {
    const p = params as { min?: number; max?: number; field?: string };
    const value = getField(output, p.field);
    if (!Array.isArray(value)) {
      return { passed: false, score: 0, details: 'Value is not an array' };
    }
    const len = value.length;
    const minOk = p.min === undefined || len >= p.min;
    const maxOk = p.max === undefined || len <= p.max;
    const passed = minOk && maxOk;
    return { passed, score: passed ? 1 : 0, details: passed ? undefined : `Array length ${len} out of bounds` };
  },

  field_exists(output: unknown, params?: unknown): CheckResult {
    const p = params as { fields: string[] };
    const missing: string[] = [];
    for (const field of p.fields) {
      const value = getField(output, field);
      if (value === undefined) missing.push(field);
    }
    const passed = missing.length === 0;
    return {
      passed,
      score: passed ? 1 : 0,
      details: passed ? undefined : `Missing fields: ${missing.join(', ')}`,
    };
  },

  exit_code(output: unknown, params?: unknown): CheckResult {
    const p = params as { expected: number };
    const o = output as { exitCode?: number };
    if (typeof o !== 'object' || o === null || !('exitCode' in o)) {
      return { passed: false, score: 0, details: 'Output missing exitCode field' };
    }
    const passed = o.exitCode === p.expected;
    return { passed, score: passed ? 1 : 0 };
  },

  output_equals(output: unknown, params?: unknown): CheckResult {
    const p = params as { expected: unknown };
    const passed = canonicalize(output) === canonicalize(p.expected);
    return { passed, score: passed ? 1 : 0 };
  },
};

/** Create a registry pre-loaded with all built-in checks */
export function createDefaultRegistry(): CheckFunctionRegistry {
  const registry = new CheckFunctionRegistry();
  for (const [name, fn] of Object.entries(builtinChecks)) {
    registry.register(name, fn);
  }
  return registry;
}

// ── Contract Creation ──

/** Generate a contract ID */
function generateContractId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `ct_${hex}`;
}

/**
 * Create a signed task contract.
 * @param issuer - Keypair of the contract issuer
 * @param task - Task specification
 * @param verification - Verification specification
 * @param constraints - Task constraints
 * @returns Signed TaskContract
 */
export function createContract(
  issuer: Keypair,
  task: TaskSpec,
  verification: VerificationSpec,
  constraints: TaskConstraints,
): TaskContract {
  const contract: TaskContract = {
    id: generateContractId(),
    version: '0.1',
    issuer: issuer.principal.id,
    createdAt: new Date().toISOString(),
    task,
    verification,
    constraints,
    signature: '',
  };

  // Sign everything except the signature field
  const { signature: _, ...toSign } = contract;
  contract.signature = signObject(issuer.privateKey, toSign);

  return contract;
}

/**
 * Verify a contract's signature.
 * @param contract - The contract to verify
 * @param issuerPublicKey - Base64url public key of the expected issuer
 * @returns true if signature is valid
 */
export function verifyContractSignature(contract: TaskContract, issuerPublicKey: string): boolean {
  const { signature, ...toVerify } = contract;
  return verifyObjectSignature(issuerPublicKey, toVerify, signature);
}

/**
 * Verify output against a contract's verification spec.
 * @param contract - The task contract
 * @param output - The output to verify
 * @param registry - Check function registry
 * @returns Result with CheckResult or error
 */
export function verifyOutput(
  contract: TaskContract,
  output: unknown,
  registry: CheckFunctionRegistry,
): Result<CheckResult, Error> {
  try {
    const result = runVerification(contract.verification, output, registry);
    return { ok: true, value: result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

function runVerification(
  spec: VerificationSpec,
  output: unknown,
  registry: CheckFunctionRegistry,
): CheckResult {
  switch (spec.method) {
    case 'schema_match': {
      if (!spec.schema) throw new Error('schema_match requires schema');
      const validate = ajv.compile(spec.schema);
      const valid = validate(output);
      return {
        passed: valid as boolean,
        score: valid ? 1 : 0,
        details: valid ? undefined : ajv.errorsText(validate.errors),
      };
    }

    case 'deterministic_check': {
      if (!spec.checkName) throw new Error('deterministic_check requires checkName');
      const fn = registry.get(spec.checkName);
      const result = fn(output, spec.checkParams);
      if (spec.expectedResult !== undefined) {
        const passed = canonicalize(result) === canonicalize(spec.expectedResult);
        return { ...result, passed };
      }
      return result;
    }

    case 'composite': {
      if (!spec.steps || !spec.mode) throw new Error('composite requires steps and mode');
      const results: CheckResult[] = [];

      for (let i = 0; i < spec.steps.length; i++) {
        const r = runVerification(spec.steps[i], output, registry);
        results.push(r);
        if (spec.mode === 'all_pass' && !r.passed) {
          return { passed: false, score: 0, details: `Step ${i} failed: ${r.details ?? 'no details'}` };
        }
      }

      switch (spec.mode) {
        case 'all_pass':
          return { passed: true, score: 1 };

        case 'majority': {
          const passCount = results.filter(r => r.passed).length;
          const score = passCount / results.length;
          return { passed: passCount > results.length / 2, score };
        }

        case 'weighted': {
          if (!spec.weights || spec.weights.length !== spec.steps.length) {
            throw new Error('weighted mode requires weights matching steps length');
          }
          const weightedScore = spec.weights.reduce((sum, w, i) => {
            const s = results[i].score ?? (results[i].passed ? 1 : 0);
            return sum + w * s;
          }, 0);
          const threshold = spec.passThreshold ?? 0.7;
          return { passed: weightedScore >= threshold, score: weightedScore };
        }

        default:
          throw new Error(`Unknown composite mode: ${spec.mode}`);
      }
    }

    default:
      throw new Error(`Unknown verification method: ${spec.method}`);
  }
}
