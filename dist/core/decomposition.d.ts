/**
 * Contract Decomposition Engine — recursive task splitting for complex contracts.
 */
import type { TaskContract, SubTask, DecompositionPlan, DecompositionStrategy, Capability, Result } from './types.js';
/**
 * Decompose a contract into sub-tasks using the given strategy.
 */
export declare function decompose(contract: TaskContract, strategy: DecompositionStrategy): DecompositionPlan;
/**
 * Validate that a decomposition plan respects parent contract constraints.
 * Checks budget totals, deadline compliance, capability subsets, and dependency cycles.
 * @param plan - The decomposition plan to validate
 * @param parentContract - The parent contract whose constraints must be respected
 * @returns Result indicating success or a descriptive error
 */
export declare function validatePlan(plan: DecompositionPlan, parentContract: TaskContract): Result<void>;
/**
 * Sequential strategy: splits task into ordered sub-tasks where each depends on the previous.
 */
export declare class SequentialStrategy implements DecompositionStrategy {
    private splits;
    name: string;
    constructor(splits: Array<{
        title: string;
        description: string;
        capabilities: Capability[];
        budgetFraction: number;
        deadlineOffsetMs?: number;
    }>);
    decompose(contract: TaskContract): SubTask[];
}
/**
 * Parallel strategy: splits task into independent sub-tasks with no dependencies.
 */
export declare class ParallelStrategy implements DecompositionStrategy {
    private splits;
    name: string;
    constructor(splits: Array<{
        title: string;
        description: string;
        capabilities: Capability[];
        budgetFraction: number;
    }>);
    decompose(contract: TaskContract): SubTask[];
}
