import type { Keypair, Principal, SerializedDCT } from '../core/types.js';
import { SpecialistAgent, type Finding } from './specialist.js';
export interface PRReviewRequest {
    prTitle: string;
    prDescription: string;
    files: string[];
}
export interface DelegationPlan {
    specialty: string;
    specialist: SpecialistAgent;
    files: string[];
    dct: SerializedDCT;
    delegationId: string;
}
export interface MergedReview {
    prTitle: string;
    totalFindings: number;
    criticalCount: number;
    warningCount: number;
    infoCount: number;
    specialistResults: {
        name: string;
        specialty: string;
        findings: Finding[];
        attestationId: string;
        attestationValid: boolean;
    }[];
    attestationChain: string[];
    overallRecommendation: 'approve' | 'request_changes' | 'reject';
}
export declare class OrchestratorAgent {
    readonly keypair: Keypair;
    private specialists;
    constructor(keypair: Keypair);
    registerSpecialist(specialty: string, agent: SpecialistAgent): void;
    /** Create the root DCT with full permissions */
    createRootDCT(contractId: string, delegatee: Principal): SerializedDCT;
    /** Decompose PR into sub-tasks and create attenuated DCTs */
    planDelegations(request: PRReviewRequest, rootDCT: SerializedDCT, contractId: string): DelegationPlan[];
    /** Execute the full PR review delegation flow */
    executeReview(request: PRReviewRequest, contractId: string, revokeSpecialty?: string): Promise<MergedReview>;
    /** Categorize files by specialty based on path/extension patterns */
    private categorizeFiles;
    /** Get resource glob patterns for a specialty */
    private getResourcePatterns;
}
