/**
 * SQLite storage adapter using better-sqlite3.
 */

import Database from 'better-sqlite3';
import type {
  StorageAdapter,
  Delegation,
  DelegationFilter,
  Attestation,
  TrustProfile,
  RevocationEntry,
  TaskContract,
} from '../core/types.js';

export class SqliteStorageAdapter implements StorageAdapter {
  private db: Database.Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.createTables();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS delegations (
        id TEXT PRIMARY KEY,
        parent_id TEXT NOT NULL,
        "from" TEXT NOT NULL,
        "to" TEXT NOT NULL,
        contract_id TEXT NOT NULL,
        dct_json TEXT NOT NULL,
        depth INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        attestation_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_delegations_contract ON delegations(contract_id);
      CREATE INDEX IF NOT EXISTS idx_delegations_from ON delegations("from");
      CREATE INDEX IF NOT EXISTS idx_delegations_to ON delegations("to");
      CREATE INDEX IF NOT EXISTS idx_delegations_status ON delegations(status);

      CREATE TABLE IF NOT EXISTS attestations (
        id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        contract_id TEXT NOT NULL,
        delegation_id TEXT NOT NULL,
        principal TEXT NOT NULL,
        created_at TEXT NOT NULL,
        type TEXT NOT NULL,
        result_json TEXT NOT NULL,
        child_attestations_json TEXT NOT NULL,
        signature TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_attestations_contract ON attestations(contract_id);

      CREATE TABLE IF NOT EXISTS trust_profiles (
        principal_id TEXT PRIMARY KEY,
        outcomes_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS revocations (
        revocation_id TEXT PRIMARY KEY,
        revoked_by TEXT NOT NULL,
        revoked_at TEXT NOT NULL,
        scope TEXT NOT NULL,
        signature TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS contracts (
        id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        issuer TEXT NOT NULL,
        created_at TEXT NOT NULL,
        task_json TEXT NOT NULL,
        verification_json TEXT NOT NULL,
        constraints_json TEXT NOT NULL,
        signature TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_contracts_issuer ON contracts(issuer);
    `);
  }

  async saveDelegation(d: Delegation): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO delegations (id, parent_id, "from", "to", contract_id, dct_json, depth, status, created_at, completed_at, attestation_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(d.id, d.parentId, d.from, d.to, d.contractId, JSON.stringify(d.dct), d.depth, d.status, d.createdAt, d.completedAt ?? null, d.attestationId ?? null);
  }

  async getDelegation(id: string): Promise<Delegation | null> {
    const row = this.db.prepare('SELECT * FROM delegations WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToDelegation(row) : null;
  }

  async listDelegations(filter?: DelegationFilter): Promise<Delegation[]> {
    let sql = 'SELECT * FROM delegations WHERE 1=1';
    const params: unknown[] = [];
    if (filter?.contractId) { sql += ' AND contract_id = ?'; params.push(filter.contractId); }
    if (filter?.from) { sql += ' AND "from" = ?'; params.push(filter.from); }
    if (filter?.to) { sql += ' AND "to" = ?'; params.push(filter.to); }
    if (filter?.status) { sql += ' AND status = ?'; params.push(filter.status); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.rowToDelegation(r));
  }

  async saveAttestation(a: Attestation): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO attestations (id, version, contract_id, delegation_id, principal, created_at, type, result_json, child_attestations_json, signature)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(a.id, a.version, a.contractId, a.delegationId, a.principal, a.createdAt, a.type, JSON.stringify(a.result), JSON.stringify(a.childAttestations), a.signature);
  }

  async getAttestation(id: string): Promise<Attestation | null> {
    const row = this.db.prepare('SELECT * FROM attestations WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      version: row.version as '0.1',
      contractId: row.contract_id as string,
      delegationId: row.delegation_id as string,
      principal: row.principal as string,
      createdAt: row.created_at as string,
      type: row.type as 'completion' | 'delegation_verification',
      result: JSON.parse(row.result_json as string),
      childAttestations: JSON.parse(row.child_attestations_json as string),
      signature: row.signature as string,
    };
  }

  async saveTrustProfile(p: TrustProfile): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO trust_profiles (principal_id, outcomes_json, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(p.principalId, JSON.stringify(p.outcomes), p.createdAt, p.updatedAt);
  }

  async getTrustProfile(principalId: string): Promise<TrustProfile | null> {
    const row = this.db.prepare('SELECT * FROM trust_profiles WHERE principal_id = ?').get(principalId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      principalId: row.principal_id as string,
      outcomes: JSON.parse(row.outcomes_json as string),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  async saveRevocation(e: RevocationEntry): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO revocations (revocation_id, revoked_by, revoked_at, scope, signature)
      VALUES (?, ?, ?, ?, ?)
    `).run(e.revocationId, e.revokedBy, e.revokedAt, e.scope, e.signature);
  }

  async getRevocations(): Promise<RevocationEntry[]> {
    const rows = this.db.prepare('SELECT * FROM revocations').all() as Record<string, unknown>[];
    return rows.map(r => ({
      revocationId: r.revocation_id as string,
      revokedBy: r.revoked_by as string,
      revokedAt: r.revoked_at as string,
      scope: r.scope as 'block' | 'chain',
      signature: r.signature as string,
    }));
  }

  async saveContract(c: TaskContract): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO contracts (id, version, issuer, created_at, task_json, verification_json, constraints_json, signature)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(c.id, c.version, c.issuer, c.createdAt, JSON.stringify(c.task), JSON.stringify(c.verification), JSON.stringify(c.constraints), c.signature);
  }

  async getContract(id: string): Promise<TaskContract | null> {
    const row = this.db.prepare('SELECT * FROM contracts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      version: row.version as '0.1',
      issuer: row.issuer as string,
      createdAt: row.created_at as string,
      task: JSON.parse(row.task_json as string),
      verification: JSON.parse(row.verification_json as string),
      constraints: JSON.parse(row.constraints_json as string),
      signature: row.signature as string,
    };
  }

  close(): void {
    this.db.close();
  }

  private rowToDelegation(row: Record<string, unknown>): Delegation {
    return {
      id: row.id as string,
      parentId: row.parent_id as string,
      from: row.from as string,
      to: row.to as string,
      contractId: row.contract_id as string,
      dct: JSON.parse(row.dct_json as string),
      depth: row.depth as number,
      status: row.status as Delegation['status'],
      createdAt: row.created_at as string,
      completedAt: row.completed_at as string | undefined,
      attestationId: row.attestation_id as string | undefined,
    };
  }
}
