/**
 * Task Contracts — Creation, signing, verification.
 */
import type { TaskContract, TaskSpec, TaskConstraints, VerificationSpec, CheckResult, CheckFunction, Keypair, Result } from './types.js';
/** Registry for check functions used in deterministic verification */
export declare class CheckFunctionRegistry {
    private fns;
    /** Register a check function */
    register(name: string, fn: CheckFunction): void;
    /** Get a registered function (throws if not found) */
    get(name: string): CheckFunction;
    /** List all registered function names */
    list(): string[];
}
/** Create a registry pre-loaded with all built-in checks */
export declare function createDefaultRegistry(): CheckFunctionRegistry;
/**
 * Create a signed task contract.
 * @param issuer - Keypair of the contract issuer
 * @param task - Task specification
 * @param verification - Verification specification
 * @param constraints - Task constraints
 * @returns Signed TaskContract
 */
export declare function createContract(issuer: Keypair, task: TaskSpec, verification: VerificationSpec, constraints: TaskConstraints): TaskContract;
/**
 * Verify a contract's signature.
 * @param contract - The contract to verify
 * @param issuerPublicKey - Base64url public key of the expected issuer
 * @returns true if signature is valid
 */
export declare function verifyContractSignature(contract: TaskContract, issuerPublicKey: string): boolean;
/**
 * Verify output against a contract's verification spec.
 * @param contract - The task contract
 * @param output - The output to verify
 * @param registry - Check function registry
 * @returns Result with CheckResult or error
 */
export declare function verifyOutput(contract: TaskContract, output: unknown, registry: CheckFunctionRegistry): Result<CheckResult, Error>;
