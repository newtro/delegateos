/**
 * Contract Decomposition Engine — recursive task splitting for complex contracts.
 */
function generateId() {
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(6)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    return `st_${hex}`;
}
function generatePlanId() {
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(6)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    return `plan_${hex}`;
}
/**
 * Decompose a contract into sub-tasks using the given strategy.
 */
export function decompose(contract, strategy) {
    const subTasks = strategy.decompose(contract);
    return {
        id: generatePlanId(),
        parentContractId: contract.id,
        strategy: strategy.name,
        subTasks,
        createdAt: new Date().toISOString(),
    };
}
/**
 * Validate that a decomposition plan respects parent contract constraints.
 * Checks budget totals, deadline compliance, capability subsets, and dependency cycles.
 * @param plan - The decomposition plan to validate
 * @param parentContract - The parent contract whose constraints must be respected
 * @returns Result indicating success or a descriptive error
 */
export function validatePlan(plan, parentContract) {
    // Budget: sum of sub-task budgets must not exceed parent
    const totalBudget = plan.subTasks.reduce((s, t) => s + t.budgetMicrocents, 0);
    if (totalBudget > parentContract.constraints.maxBudgetMicrocents) {
        return {
            ok: false,
            error: new Error(`Total sub-task budget (${totalBudget}) exceeds parent budget (${parentContract.constraints.maxBudgetMicrocents})`),
        };
    }
    // Deadline: all sub-task deadlines must be ≤ parent deadline
    for (const task of plan.subTasks) {
        if (task.deadline > parentContract.constraints.deadline) {
            return {
                ok: false,
                error: new Error(`Sub-task "${task.title}" deadline (${task.deadline}) exceeds parent deadline (${parentContract.constraints.deadline})`),
            };
        }
    }
    // Capabilities: all sub-task capabilities must be subsets of parent required capabilities
    // (We check that each sub-task capability namespace is in the parent's requiredCapabilities list)
    const parentCaps = new Set(parentContract.constraints.requiredCapabilities);
    for (const task of plan.subTasks) {
        for (const cap of task.capabilities) {
            if (!parentCaps.has(cap.namespace) && !parentCaps.has('*')) {
                return {
                    ok: false,
                    error: new Error(`Sub-task "${task.title}" capability namespace "${cap.namespace}" not in parent required capabilities`),
                };
            }
        }
    }
    // Dependencies: check for cycles and that all referenced IDs exist
    const ids = new Set(plan.subTasks.map(t => t.id));
    for (const task of plan.subTasks) {
        for (const dep of task.dependsOn) {
            if (!ids.has(dep)) {
                return {
                    ok: false,
                    error: new Error(`Sub-task "${task.title}" depends on unknown task "${dep}"`),
                };
            }
            if (dep === task.id) {
                return { ok: false, error: new Error(`Sub-task "${task.title}" depends on itself`) };
            }
        }
    }
    // Check for cycles using DFS
    const cycleCheck = detectCycle(plan.subTasks);
    if (cycleCheck) {
        return { ok: false, error: new Error(`Dependency cycle detected involving task "${cycleCheck}"`) };
    }
    return { ok: true, value: undefined };
}
function detectCycle(tasks) {
    const adj = new Map();
    for (const t of tasks) {
        adj.set(t.id, t.dependsOn);
    }
    const visited = new Set();
    const inStack = new Set();
    function dfs(id) {
        if (inStack.has(id))
            return id;
        if (visited.has(id))
            return null;
        visited.add(id);
        inStack.add(id);
        for (const dep of (adj.get(id) ?? [])) {
            const result = dfs(dep);
            if (result)
                return result;
        }
        inStack.delete(id);
        return null;
    }
    for (const t of tasks) {
        const result = dfs(t.id);
        if (result)
            return result;
    }
    return null;
}
/**
 * Sequential strategy: splits task into ordered sub-tasks where each depends on the previous.
 */
export class SequentialStrategy {
    splits;
    name = 'sequential';
    constructor(splits) {
        this.splits = splits;
    }
    decompose(contract) {
        const tasks = [];
        const parentDeadline = new Date(contract.constraints.deadline).getTime();
        const parentBudget = contract.constraints.maxBudgetMicrocents;
        for (let i = 0; i < this.splits.length; i++) {
            const split = this.splits[i];
            const id = generateId();
            const deadline = split.deadlineOffsetMs
                ? new Date(Math.min(parentDeadline, Date.now() + split.deadlineOffsetMs)).toISOString()
                : contract.constraints.deadline;
            tasks.push({
                id,
                title: split.title,
                description: split.description,
                capabilities: split.capabilities,
                budgetMicrocents: Math.floor(parentBudget * split.budgetFraction),
                deadline,
                dependsOn: i > 0 ? [tasks[i - 1].id] : [],
            });
        }
        return tasks;
    }
}
/**
 * Parallel strategy: splits task into independent sub-tasks with no dependencies.
 */
export class ParallelStrategy {
    splits;
    name = 'parallel';
    constructor(splits) {
        this.splits = splits;
    }
    decompose(contract) {
        const parentBudget = contract.constraints.maxBudgetMicrocents;
        return this.splits.map(split => ({
            id: generateId(),
            title: split.title,
            description: split.description,
            capabilities: split.capabilities,
            budgetMicrocents: Math.floor(parentBudget * split.budgetFraction),
            deadline: contract.constraints.deadline,
            dependsOn: [],
        }));
    }
}
