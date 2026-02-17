// DelegateOS Demo — Specialist Agent
// Receives delegated tasks, performs review, returns attestation
import { verifyDCT } from '../core/dct.js';
import { createCompletionAttestation } from '../core/attestation.js';
// Mock findings by specialty
const MOCK_FINDINGS = {
    security: [
        { file: 'src/auth/login.cs', severity: 'critical', message: 'SQL injection vulnerability in user input handling', line: 42 },
        { file: 'src/auth/token.cs', severity: 'warning', message: 'JWT secret should use asymmetric keys', line: 15 },
        { file: 'src/middleware/cors.cs', severity: 'info', message: 'CORS policy allows wildcard origin in dev mode', line: 8 },
    ],
    blazor: [
        { file: 'src/components/Dashboard.razor', severity: 'warning', message: 'Component re-renders on every state change — add ShouldRender override', line: 67 },
        { file: 'src/components/DataGrid.razor', severity: 'info', message: 'Consider virtualizing large list rendering', line: 120 },
        { file: 'src/pages/Settings.razor', severity: 'warning', message: 'Missing null check on cascading parameter', line: 33 },
    ],
    database: [
        { file: 'src/data/migrations/003_add_index.sql', severity: 'critical', message: 'Missing index on frequently queried foreign key column', line: 12 },
        { file: 'src/data/repositories/UserRepo.cs', severity: 'warning', message: 'N+1 query pattern detected in GetUsersWithRoles', line: 88 },
        { file: 'src/data/context/AppDbContext.cs', severity: 'info', message: 'Consider using compiled queries for hot paths', line: 45 },
    ],
};
export class SpecialistAgent {
    name;
    keypair;
    specialty;
    constructor(config) {
        this.name = config.name;
        this.keypair = config.keypair;
        this.specialty = config.specialty;
    }
    async review(task, rootPublicKey) {
        const startTime = Date.now();
        // 1. Verify our DCT is valid (check against first assigned file)
        const verifyResult = verifyDCT(task.dct, {
            resource: task.files[0],
            operation: 'analyze',
            now: new Date().toISOString(),
            spentMicrocents: 0,
            rootPublicKey,
            revocationIds: [],
        });
        if (!verifyResult.ok) {
            throw new Error(`DCT verification failed for ${this.name}: ${JSON.stringify(verifyResult.error)}`);
        }
        // 2. Check that DCT scope covers our assigned files
        const scope = verifyResult.value;
        for (const file of task.files) {
            const hasAccess = scope.capabilities.some(cap => matchesGlob(file, cap.resource));
            if (!hasAccess) {
                throw new Error(`${this.name}: DCT does not grant access to file ${file}`);
            }
        }
        // 3. Perform the review (simulated)
        const findings = this.generateFindings(task.files);
        const durationMs = Date.now() - startTime;
        // 4. Create attestation
        const result = {
            success: true,
            output: {
                specialist: this.name,
                specialty: this.specialty,
                filesReviewed: task.files,
                findingsCount: findings.length,
                findings,
            },
            costMicrocents: 500,
            durationMs,
            verificationOutcome: {
                method: 'deterministic_check',
                passed: true,
                score: 1.0,
                details: `${this.name} completed review of ${task.files.length} files`,
            },
        };
        const attestation = createCompletionAttestation(this.keypair, task.contractId, task.delegationId, result);
        return { attestation, findings };
    }
    generateFindings(files) {
        const mockFindings = MOCK_FINDINGS[this.specialty] ?? [];
        // Filter to only findings for files in our scope
        return mockFindings.filter(f => files.some(file => matchesGlob(f.file, file)));
    }
}
/** Simple glob matching for resource patterns */
function matchesGlob(path, pattern) {
    if (pattern === '*' || pattern === '**')
        return true;
    if (pattern === path)
        return true;
    // Convert glob to regex
    const regexStr = pattern
        .replace(/\*\*/g, '<<<GLOBSTAR>>>')
        .replace(/\*/g, '[^/]*')
        .replace(/<<<GLOBSTAR>>>/g, '.*');
    return new RegExp(`^${regexStr}$`).test(path);
}
