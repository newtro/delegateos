/**
 * SQLite storage adapter using better-sqlite3.
 */
import Database from 'better-sqlite3';
import { createLogger } from '../core/logger.js';
import { globalMetrics } from '../core/metrics.js';
export class SqliteStorageAdapter {
    db;
    logger = createLogger('SqliteStorage');
    constructor(dbPath = ':memory:') {
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.createTables();
        this.logger.info('SQLite storage initialized', { dbPath });
    }
    createTables() {
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
    async saveDelegation(d) {
        this.db.prepare(`
      INSERT OR REPLACE INTO delegations (id, parent_id, "from", "to", contract_id, dct_json, depth, status, created_at, completed_at, attestation_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(d.id, d.parentId, d.from, d.to, d.contractId, JSON.stringify(d.dct), d.depth, d.status, d.createdAt, d.completedAt ?? null, d.attestationId ?? null);
        globalMetrics.counter('storage.delegations_saved');
    }
    async getDelegation(id) {
        const row = this.db.prepare('SELECT * FROM delegations WHERE id = ?').get(id);
        return row ? this.rowToDelegation(row) : null;
    }
    async listDelegations(filter) {
        let sql = 'SELECT * FROM delegations WHERE 1=1';
        const params = [];
        if (filter?.contractId) {
            sql += ' AND contract_id = ?';
            params.push(filter.contractId);
        }
        if (filter?.from) {
            sql += ' AND "from" = ?';
            params.push(filter.from);
        }
        if (filter?.to) {
            sql += ' AND "to" = ?';
            params.push(filter.to);
        }
        if (filter?.status) {
            sql += ' AND status = ?';
            params.push(filter.status);
        }
        const rows = this.db.prepare(sql).all(...params);
        return rows.map(r => this.rowToDelegation(r));
    }
    async saveAttestation(a) {
        this.db.prepare(`
      INSERT OR REPLACE INTO attestations (id, version, contract_id, delegation_id, principal, created_at, type, result_json, child_attestations_json, signature)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(a.id, a.version, a.contractId, a.delegationId, a.principal, a.createdAt, a.type, JSON.stringify(a.result), JSON.stringify(a.childAttestations), a.signature);
    }
    async getAttestation(id) {
        const row = this.db.prepare('SELECT * FROM attestations WHERE id = ?').get(id);
        if (!row)
            return null;
        return {
            id: row.id,
            version: row.version,
            contractId: row.contract_id,
            delegationId: row.delegation_id,
            principal: row.principal,
            createdAt: row.created_at,
            type: row.type,
            result: JSON.parse(row.result_json),
            childAttestations: JSON.parse(row.child_attestations_json),
            signature: row.signature,
        };
    }
    async saveTrustProfile(p) {
        this.db.prepare(`
      INSERT OR REPLACE INTO trust_profiles (principal_id, outcomes_json, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(p.principalId, JSON.stringify(p.outcomes), p.createdAt, p.updatedAt);
    }
    async getTrustProfile(principalId) {
        const row = this.db.prepare('SELECT * FROM trust_profiles WHERE principal_id = ?').get(principalId);
        if (!row)
            return null;
        return {
            principalId: row.principal_id,
            outcomes: JSON.parse(row.outcomes_json),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
    async saveRevocation(e) {
        this.db.prepare(`
      INSERT OR REPLACE INTO revocations (revocation_id, revoked_by, revoked_at, scope, signature)
      VALUES (?, ?, ?, ?, ?)
    `).run(e.revocationId, e.revokedBy, e.revokedAt, e.scope, e.signature);
    }
    async getRevocations() {
        const rows = this.db.prepare('SELECT * FROM revocations').all();
        return rows.map(r => ({
            revocationId: r.revocation_id,
            revokedBy: r.revoked_by,
            revokedAt: r.revoked_at,
            scope: r.scope,
            signature: r.signature,
        }));
    }
    async saveContract(c) {
        this.db.prepare(`
      INSERT OR REPLACE INTO contracts (id, version, issuer, created_at, task_json, verification_json, constraints_json, signature)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(c.id, c.version, c.issuer, c.createdAt, JSON.stringify(c.task), JSON.stringify(c.verification), JSON.stringify(c.constraints), c.signature);
    }
    async getContract(id) {
        const row = this.db.prepare('SELECT * FROM contracts WHERE id = ?').get(id);
        if (!row)
            return null;
        return {
            id: row.id,
            version: row.version,
            issuer: row.issuer,
            createdAt: row.created_at,
            task: JSON.parse(row.task_json),
            verification: JSON.parse(row.verification_json),
            constraints: JSON.parse(row.constraints_json),
            signature: row.signature,
        };
    }
    close() {
        this.db.close();
    }
    rowToDelegation(row) {
        return {
            id: row.id,
            parentId: row.parent_id,
            from: row.from,
            to: row.to,
            contractId: row.contract_id,
            dct: JSON.parse(row.dct_json),
            depth: row.depth,
            status: row.status,
            createdAt: row.created_at,
            completedAt: row.completed_at,
            attestationId: row.attestation_id,
        };
    }
}
