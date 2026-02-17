// Audit logger for DelegateOS MCP plugin decisions
export class AuditLog {
    entries = [];
    log(entry) {
        this.entries.push(entry);
    }
    allowed(opts) {
        this.log({
            timestamp: new Date().toISOString(),
            decision: 'allowed',
            ...opts,
        });
    }
    denied(opts) {
        this.log({
            timestamp: new Date().toISOString(),
            decision: 'denied',
            ...opts,
        });
    }
    passthrough(method) {
        this.log({
            timestamp: new Date().toISOString(),
            decision: 'passthrough',
            method,
        });
    }
    getEntries() {
        return [...this.entries];
    }
    getByDecision(decision) {
        return this.entries.filter(e => e.decision === decision);
    }
    getByDelegation(delegationId) {
        return this.entries.filter(e => e.delegationId === delegationId);
    }
    clear() {
        this.entries = [];
    }
    toJSON() {
        return JSON.stringify(this.entries, null, 2);
    }
}
