export type AuditDecision = 'allowed' | 'denied' | 'passthrough';
export interface AuditEntry {
    timestamp: string;
    decision: AuditDecision;
    method: string;
    toolName?: string;
    delegationId?: string;
    contractId?: string;
    reason?: string;
    denialType?: string;
    resource?: string;
    operation?: string;
}
export declare class AuditLog {
    private entries;
    log(entry: AuditEntry): void;
    allowed(opts: {
        method: string;
        toolName?: string;
        delegationId?: string;
        contractId?: string;
        resource?: string;
        operation?: string;
    }): void;
    denied(opts: {
        method: string;
        toolName?: string;
        delegationId?: string;
        contractId?: string;
        reason: string;
        denialType?: string;
        resource?: string;
        operation?: string;
    }): void;
    passthrough(method: string): void;
    getEntries(): AuditEntry[];
    getByDecision(decision: AuditDecision): AuditEntry[];
    getByDelegation(delegationId: string): AuditEntry[];
    clear(): void;
    toJSON(): string;
}
