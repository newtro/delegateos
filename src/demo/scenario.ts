#!/usr/bin/env npx tsx
// DelegateOS Demo Scenario — Runnable PR Review Delegation
// Usage: npx tsx src/demo/scenario.ts

import { generateKeypair } from '../core/crypto.js';
import { InMemoryRevocationList } from '../core/revocation.js';
import { verifyDCT, attenuateDCT, createDCT } from '../core/dct.js';
import { OrchestratorAgent } from './orchestrator.js';
import { SpecialistAgent } from './specialist.js';

// ═══════════════════════════════════════════
// Utility
// ═══════════════════════════════════════════

function banner(title: string): void {
  console.log('\n' + '═'.repeat(60));
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

function section(title: string): void {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 50 - title.length))}`);
}

// ═══════════════════════════════════════════
// Setup
// ═══════════════════════════════════════════

async function main() {
  banner('DelegateOS v0.1 — PR Review Delegation Demo');

  // Generate keypairs for all agents
  section('Generating Agent Keypairs');
  const orchestratorKeys = generateKeypair();
  const securityKeys = generateKeypair();
  const blazorKeys = generateKeypair();
  const dbKeys = generateKeypair();

  console.log(`  Orchestrator: ${orchestratorKeys.principal.id.slice(0, 16)}...`);
  console.log(`  Security:     ${securityKeys.principal.id.slice(0, 16)}...`);
  console.log(`  Blazor:       ${blazorKeys.principal.id.slice(0, 16)}...`);
  console.log(`  Database:     ${dbKeys.principal.id.slice(0, 16)}...`);

  // Create agents
  const orchestrator = new OrchestratorAgent(orchestratorKeys);
  const securityAgent = new SpecialistAgent({ name: 'SecurityBot', keypair: securityKeys, specialty: 'security' });
  const blazorAgent = new SpecialistAgent({ name: 'BlazorExpert', keypair: blazorKeys, specialty: 'blazor' });
  const dbAgent = new SpecialistAgent({ name: 'DBAnalyzer', keypair: dbKeys, specialty: 'database' });

  orchestrator.registerSpecialist('security', securityAgent);
  orchestrator.registerSpecialist('blazor', blazorAgent);
  orchestrator.registerSpecialist('database', dbAgent);

  const revocations = new InMemoryRevocationList();
  const contractId = 'ct_pr_review_001';

  // ═══════════════════════════════════════════
  // Demo 1: Full successful delegation flow
  // ═══════════════════════════════════════════

  banner('Demo 1: Successful PR Review Delegation');

  const prFiles = [
    'src/auth/login.cs',
    'src/auth/token.cs',
    'src/middleware/cors.cs',
    'src/components/Dashboard.razor',
    'src/components/DataGrid.razor',
    'src/pages/Settings.razor',
    'src/data/migrations/003_add_index.sql',
    'src/data/repositories/UserRepo.cs',
    'src/data/context/AppDbContext.cs',
  ];

  section('PR Files');
  prFiles.forEach(f => console.log(`  📄 ${f}`));

  section('Executing Review...');
  const review = await orchestrator.executeReview(
    {
      prTitle: 'feat: Add user dashboard with role-based auth',
      prDescription: 'Implements new dashboard component with auth middleware and DB migrations',
      files: prFiles,
    },
    contractId,
  );

  section('Review Results');
  console.log(`  PR: ${review.prTitle}`);
  console.log(`  Recommendation: ${review.overallRecommendation.toUpperCase()}`);
  console.log(`  Total Findings: ${review.totalFindings}`);
  console.log(`    🔴 Critical: ${review.criticalCount}`);
  console.log(`    🟡 Warning:  ${review.warningCount}`);
  console.log(`    🔵 Info:     ${review.infoCount}`);

  section('Specialist Reports');
  for (const result of review.specialistResults) {
    console.log(`\n  🤖 ${result.name} (${result.specialty})`);
    console.log(`     Attestation: ${result.attestationId}`);
    console.log(`     Signature Valid: ${result.attestationValid ? '✅' : '❌'}`);
    for (const finding of result.findings) {
      const icon = finding.severity === 'critical' ? '🔴' :
                   finding.severity === 'warning' ? '🟡' : '🔵';
      console.log(`     ${icon} [${finding.file}:${finding.line}] ${finding.message}`);
    }
  }

  section('Attestation Chain');
  review.attestationChain.forEach((id, i) => {
    console.log(`  ${i + 1}. ${id}`);
  });

  // ═══════════════════════════════════════════
  // Demo 2: Token Attenuation — scope violation
  // ═══════════════════════════════════════════

  banner('Demo 2: Token Attenuation Enforcement');

  section('Creating attenuated DCT scoped to src/auth/**');
  const rootDCT = orchestrator.createRootDCT(contractId, orchestratorKeys.principal);

  const narrowDCT = attenuateDCT({
    token: rootDCT,
    attenuator: orchestratorKeys,
    delegatee: securityKeys.principal,
    delegationId: 'del_attenuation_test',
    contractId,
    allowedCapabilities: [
      { namespace: 'code', action: 'analyze', resource: 'src/auth/**' },
    ],
    maxBudgetMicrocents: 1000,
    expiresAt: new Date(Date.now() + 1800_000).toISOString(),
    maxChainDepth: 1,
  });

  // Verify: access to auth files should work
  const authResult = verifyDCT(narrowDCT, {
    resource: 'src/auth/login.cs',
    operation: 'analyze',
    now: new Date().toISOString(),
    spentMicrocents: 0,
    rootPublicKey: orchestratorKeys.principal.id,
    revocationIds: revocations.getRevocationIds(),
  });
  console.log(`  Access to src/auth/login.cs: ${authResult.ok ? '✅ ALLOWED' : '❌ DENIED'}`);

  // Verify: access to data files should fail
  const dataResult = verifyDCT(narrowDCT, {
    resource: 'src/data/repos/UserRepo.cs',
    operation: 'analyze',
    now: new Date().toISOString(),
    spentMicrocents: 0,
    rootPublicKey: orchestratorKeys.principal.id,
    revocationIds: revocations.getRevocationIds(),
  });
  console.log(`  Access to src/data/repos/UserRepo.cs: ${dataResult.ok ? '✅ ALLOWED' : '❌ DENIED'}`);
  if (!dataResult.ok) {
    console.log(`  Denial reason: ${dataResult.error.type}`);
  }

  // ═══════════════════════════════════════════
  // Demo 3: Revocation mid-flow
  // ═══════════════════════════════════════════

  banner('Demo 3: Revocation Mid-Flow');
  section('Running review with database specialist revoked mid-flow');

  const review2 = await orchestrator.executeReview(
    {
      prTitle: 'feat: Add user dashboard with role-based auth',
      prDescription: 'Same PR, but DB specialist gets revoked',
      files: prFiles,
    },
    'ct_pr_review_002',
    'database', // Revoke database specialist
  );

  for (const result of review2.specialistResults) {
    const status = result.attestationId === 'REVOKED' ? '🚫 REVOKED' :
                   result.attestationValid ? '✅ Valid' : '❌ Invalid';
    console.log(`  ${result.name} (${result.specialty}): ${status}`);
  }
  console.log(`  Recommendation: ${review2.overallRecommendation.toUpperCase()}`);

  // ═══════════════════════════════════════════
  // Demo 4: Expired token rejection
  // ═══════════════════════════════════════════

  banner('Demo 4: Expired Token Rejection');

  section('Creating DCT that expired 1 hour ago');
  const expiredDCT = createDCT({
    issuer: orchestratorKeys,
    delegatee: securityKeys.principal,
    capabilities: [{ namespace: 'code', action: 'analyze', resource: '**' }],
    contractId,
    delegationId: 'del_expired_test',
    parentDelegationId: 'del_000000000000',
    chainDepth: 0,
    maxChainDepth: 3,
    maxBudgetMicrocents: 10000,
    expiresAt: new Date(Date.now() - 3600_000).toISOString(), // 1 hour ago
  });

  const expiredResult = verifyDCT(expiredDCT, {
    resource: 'src/auth/login.cs',
    operation: 'analyze',
    now: new Date().toISOString(),
    spentMicrocents: 0,
    rootPublicKey: orchestratorKeys.principal.id,
    revocationIds: revocations.getRevocationIds(),
  });

  console.log(`  Verification: ${expiredResult.ok ? '✅ ALLOWED' : '❌ DENIED'}`);
  if (!expiredResult.ok) {
    console.log(`  Denial reason: ${expiredResult.error.type}`);
  }

  // ═══════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════

  banner('Demo Complete');
  console.log(`
  ✅ Demonstrated:
    1. Full PR review delegation with 3 specialists
    2. Attestation creation and verification
    3. Token attenuation (scope narrowing enforced)
    4. Mid-flow revocation handling
    5. Expired token rejection

  DelegateOS v0.1 — Scoped delegation for the agentic web
  `);
}

main().catch(err => {
  console.error('Demo failed:', err);
  process.exit(1);
});
