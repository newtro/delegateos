// MCP-specific types for DelegateOS middleware
/** Simple in-memory budget tracker */
export class InMemoryBudgetTracker {
    spent = new Map();
    getSpent(delegationId) {
        return this.spent.get(delegationId) ?? 0;
    }
    recordSpend(delegationId, microcents) {
        this.spent.set(delegationId, this.getSpent(delegationId) + microcents);
    }
}
