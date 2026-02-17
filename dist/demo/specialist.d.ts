import type { Keypair, SerializedDCT, Attestation } from '../core/types.js';
export interface SpecialistConfig {
    name: string;
    keypair: Keypair;
    specialty: 'security' | 'blazor' | 'database';
}
export interface ReviewTask {
    contractId: string;
    delegationId: string;
    dct: SerializedDCT;
    files: string[];
    description: string;
}
export interface ReviewResult {
    attestation: Attestation;
    findings: Finding[];
}
export interface Finding {
    file: string;
    severity: 'critical' | 'warning' | 'info';
    message: string;
    line?: number;
}
export declare class SpecialistAgent {
    readonly name: string;
    readonly keypair: Keypair;
    readonly specialty: string;
    constructor(config: SpecialistConfig);
    review(task: ReviewTask, rootPublicKey: string): Promise<ReviewResult>;
    private generateFindings;
}
