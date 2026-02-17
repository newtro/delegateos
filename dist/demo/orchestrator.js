// DelegateOS Demo — Orchestrator Agent
// Creates root DCT, decomposes PR review, delegates to specialists
import { createDCT, attenuateDCT } from '../core/dct.js';
import { verifyAttestationSignature } from '../core/attestation.js';
let delegationCounter = 0;
function nextDelegationId() {
    delegationCounter++;
    return `del_${delegationCounter.toString(16).padStart(12, '0')}`;
}
export class OrchestratorAgent {
    keypair;
    specialists = new Map();
    constructor(keypair) {
        this.keypair = keypair;
    }
    registerSpecialist(specialty, agent) {
        this.specialists.set(specialty, agent);
    }
    /** Create the root DCT with full permissions */
    createRootDCT(contractId, delegatee) {
        return createDCT({
            issuer: this.keypair,
            delegatee,
            capabilities: [
                { namespace: 'code', action: 'analyze', resource: '**' },
                { namespace: 'code', action: 'read', resource: '**' },
                { namespace: 'docs', action: 'read', resource: '**' },
            ],
            contractId,
            delegationId: nextDelegationId(),
            parentDelegationId: 'del_000000000000',
            chainDepth: 0,
            maxChainDepth: 3,
            maxBudgetMicrocents: 10000,
            expiresAt: new Date(Date.now() + 3600_000).toISOString(), // 1 hour
        });
    }
    /** Decompose PR into sub-tasks and create attenuated DCTs */
    planDelegations(request, rootDCT, contractId) {
        const filesBySpecialty = this.categorizeFiles(request.files);
        const plans = [];
        for (const [specialty, files] of Object.entries(filesBySpecialty)) {
            const specialist = this.specialists.get(specialty);
            if (!specialist || files.length === 0)
                continue;
            const delegationId = nextDelegationId();
            // Create attenuated DCT scoped to this specialist's files
            const resourcePatterns = this.getResourcePatterns(specialty);
            const allowedCapabilities = resourcePatterns.flatMap(pattern => [
                { namespace: 'code', action: 'analyze', resource: pattern },
                { namespace: 'code', action: 'read', resource: pattern },
            ]);
            const dct = attenuateDCT({
                token: rootDCT,
                attenuator: this.keypair,
                delegatee: specialist.keypair.principal,
                delegationId,
                contractId,
                allowedCapabilities,
                maxBudgetMicrocents: 3000, // Budget per specialist
                expiresAt: new Date(Date.now() + 1800_000).toISOString(), // 30 min
                maxChainDepth: 1, // Specialists can't sub-delegate
            });
            plans.push({ specialty, specialist, files, dct, delegationId });
        }
        return plans;
    }
    /** Execute the full PR review delegation flow */
    async executeReview(request, contractId, revokeSpecialty) {
        const rootDCT = this.createRootDCT(contractId, this.keypair.principal);
        const plans = this.planDelegations(request, rootDCT, contractId);
        const results = [];
        const attestationChain = [];
        for (const plan of plans) {
            // Demo: revoke a specialist mid-flow
            if (revokeSpecialty && plan.specialty === revokeSpecialty) {
                results.push({
                    name: plan.specialist.name,
                    specialty: plan.specialty,
                    findings: [],
                    attestationId: 'REVOKED',
                    attestationValid: false,
                });
                continue;
            }
            try {
                const reviewResult = await plan.specialist.review({
                    contractId,
                    delegationId: plan.delegationId,
                    dct: plan.dct,
                    files: plan.files,
                    description: `Review ${plan.specialty} aspects of PR: ${request.prTitle}`,
                }, this.keypair.principal.id);
                // Verify the attestation
                const attestationValid = verifyAttestationSignature(reviewResult.attestation, plan.specialist.keypair.principal.id);
                attestationChain.push(reviewResult.attestation.id);
                results.push({
                    name: plan.specialist.name,
                    specialty: plan.specialty,
                    findings: reviewResult.findings,
                    attestationId: reviewResult.attestation.id,
                    attestationValid,
                });
            }
            catch (err) {
                results.push({
                    name: plan.specialist.name,
                    specialty: plan.specialty,
                    findings: [],
                    attestationId: 'ERROR',
                    attestationValid: false,
                });
            }
        }
        // Aggregate findings
        const allFindings = results.flatMap(r => r.findings);
        const criticalCount = allFindings.filter(f => f.severity === 'critical').length;
        const warningCount = allFindings.filter(f => f.severity === 'warning').length;
        const infoCount = allFindings.filter(f => f.severity === 'info').length;
        const recommendation = criticalCount > 0 ? 'request_changes' :
            warningCount > 2 ? 'request_changes' :
                'approve';
        return {
            prTitle: request.prTitle,
            totalFindings: allFindings.length,
            criticalCount,
            warningCount,
            infoCount,
            specialistResults: results,
            attestationChain,
            overallRecommendation: recommendation,
        };
    }
    /** Categorize files by specialty based on path/extension patterns */
    categorizeFiles(files) {
        const result = {
            security: [],
            blazor: [],
            database: [],
        };
        for (const file of files) {
            if (file.includes('/auth/') || file.includes('/middleware/') || file.includes('/security/')) {
                result.security.push(file);
            }
            else if (file.endsWith('.razor') || file.includes('/components/') || file.includes('/pages/')) {
                result.blazor.push(file);
            }
            else if (file.includes('/data/') || file.includes('/migrations/') || file.endsWith('.sql')) {
                result.database.push(file);
            }
        }
        return result;
    }
    /** Get resource glob patterns for a specialty */
    getResourcePatterns(specialty) {
        switch (specialty) {
            case 'security': return ['src/auth/**', 'src/middleware/**', 'src/security/**'];
            case 'blazor': return ['src/components/**', 'src/pages/**'];
            case 'database': return ['src/data/**', 'src/migrations/**'];
            default: return ['**'];
        }
    }
}
