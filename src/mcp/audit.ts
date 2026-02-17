// Audit logger for DelegateOS MCP plugin decisions

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

export class AuditLog {
  private entries: AuditEntry[] = [];

  log(entry: AuditEntry): void {
    this.entries.push(entry);
  }

  allowed(opts: {
    method: string;
    toolName?: string;
    delegationId?: string;
    contractId?: string;
    resource?: string;
    operation?: string;
  }): void {
    this.log({
      timestamp: new Date().toISOString(),
      decision: 'allowed',
      ...opts,
    });
  }

  denied(opts: {
    method: string;
    toolName?: string;
    delegationId?: string;
    contractId?: string;
    reason: string;
    denialType?: string;
    resource?: string;
    operation?: string;
  }): void {
    this.log({
      timestamp: new Date().toISOString(),
      decision: 'denied',
      ...opts,
    });
  }

  passthrough(method: string): void {
    this.log({
      timestamp: new Date().toISOString(),
      decision: 'passthrough',
      method,
    });
  }

  getEntries(): AuditEntry[] {
    return [...this.entries];
  }

  getByDecision(decision: AuditDecision): AuditEntry[] {
    return this.entries.filter(e => e.decision === decision);
  }

  getByDelegation(delegationId: string): AuditEntry[] {
    return this.entries.filter(e => e.delegationId === delegationId);
  }

  clear(): void {
    this.entries = [];
  }

  toJSON(): string {
    return JSON.stringify(this.entries, null, 2);
  }
}
