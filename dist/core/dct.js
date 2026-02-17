/**
 * DCT Engine — Delegation Capability Token creation, attenuation, and verification.
 * Implements the Signed JSON Token (SJT) format for v0.1.
 */
import { toBase64url, fromBase64url, canonicalize, blake2b256, signObject, verifyObjectSignature } from './crypto.js';
/**
 * Create a new DCT (root token).
 * @param params - Token creation parameters
 * @returns Serialized DCT
 */
export function createDCT(params) {
    const authority = {
        issuer: params.issuer.principal.id,
        delegatee: params.delegatee.id,
        capabilities: params.capabilities,
        contractId: params.contractId,
        delegationId: params.delegationId,
        parentDelegationId: params.parentDelegationId,
        chainDepth: params.chainDepth,
        maxChainDepth: params.maxChainDepth,
        maxBudgetMicrocents: params.maxBudgetMicrocents,
        expiresAt: params.expiresAt,
        issuedAt: new Date().toISOString(),
    };
    const token = {
        format: 'delegateos-sjt-v1',
        authority,
        attenuations: [],
        signatures: [{
                signer: params.issuer.principal.id,
                signature: '', // placeholder
                covers: 'authority',
            }],
    };
    // Sign
    token.signatures[0].signature = signObject(params.issuer.privateKey, { authority });
    return serialize(token);
}
/**
 * Attenuate a DCT — create a narrower child token.
 * @param params - Attenuation parameters
 * @returns New serialized DCT with reduced scope
 */
export function attenuateDCT(params) {
    const token = deserialize(params.token);
    // Determine current delegatee
    const currentDelegatee = token.attenuations.length > 0
        ? token.attenuations[token.attenuations.length - 1].delegatee
        : token.authority.delegatee;
    if (params.attenuator.principal.id !== currentDelegatee) {
        throw new Error('Attenuator must be the current delegatee');
    }
    // Compute effective values
    const effective = computeEffective(token);
    // Validate monotonic narrowing
    if (params.allowedCapabilities) {
        for (const cap of params.allowedCapabilities) {
            if (!isCapabilitySubset(cap, effective.capabilities)) {
                throw new Error(`Capability expansion not allowed: ${cap.namespace}:${cap.action}:${cap.resource}`);
            }
        }
    }
    if (params.maxBudgetMicrocents !== undefined && params.maxBudgetMicrocents > effective.budget) {
        throw new Error('Budget cannot exceed parent');
    }
    if (params.expiresAt !== undefined && params.expiresAt > effective.expiresAt) {
        throw new Error('Expiry cannot exceed parent');
    }
    if (params.maxChainDepth !== undefined && params.maxChainDepth >= effective.maxChainDepth) {
        throw new Error('Max chain depth must be less than parent');
    }
    const attenuation = {
        attenuator: params.attenuator.principal.id,
        delegatee: params.delegatee.id,
        delegationId: params.delegationId,
        contractId: params.contractId,
        ...(params.allowedCapabilities ? { allowedCapabilities: params.allowedCapabilities } : {}),
        ...(params.maxBudgetMicrocents !== undefined ? { maxBudgetMicrocents: params.maxBudgetMicrocents } : {}),
        ...(params.expiresAt !== undefined ? { expiresAt: params.expiresAt } : {}),
        ...(params.maxChainDepth !== undefined ? { maxChainDepth: params.maxChainDepth } : {}),
    };
    const newAttenuations = [...token.attenuations, attenuation];
    const signPayload = { authority: token.authority, attenuations: newAttenuations };
    const sig = signObject(params.attenuator.privateKey, signPayload);
    token.attenuations = newAttenuations;
    token.signatures.push({
        signer: params.attenuator.principal.id,
        signature: sig,
        covers: newAttenuations.length - 1,
    });
    return serialize(token);
}
/**
 * Verify a DCT against a verification context.
 * @param serialized - The serialized DCT to verify
 * @param context - Verification context (resource, operation, time, budget, etc.)
 * @returns Result with authorized scope or denial reason
 */
export function verifyDCT(serialized, context) {
    // 1. Deserialize
    let token;
    try {
        token = deserialize(serialized);
    }
    catch {
        return { ok: false, error: { type: 'malformed_token', detail: 'Failed to deserialize token' } };
    }
    // 2. Check revocations
    if (context.revocationIds) {
        const authorityRevId = computeRevocationId(token.authority);
        if (context.revocationIds.includes(authorityRevId)) {
            return { ok: false, error: { type: 'revoked', revocationId: authorityRevId } };
        }
        for (const att of token.attenuations) {
            const attRevId = computeRevocationId(att);
            if (context.revocationIds.includes(attRevId)) {
                return { ok: false, error: { type: 'revoked', revocationId: attRevId } };
            }
        }
    }
    // 3. Verify signatures
    // 3a. Authority signature
    if (token.signatures.length === 0 || token.signatures[0].covers !== 'authority') {
        return { ok: false, error: { type: 'invalid_signature', detail: 'Missing authority signature' } };
    }
    if (token.authority.issuer !== context.rootPublicKey) {
        return { ok: false, error: { type: 'invalid_signature', detail: 'Issuer does not match root public key' } };
    }
    const authPayload = { authority: token.authority };
    if (!verifyObjectSignature(token.signatures[0].signer, authPayload, token.signatures[0].signature)) {
        return { ok: false, error: { type: 'invalid_signature', detail: 'Authority signature invalid' } };
    }
    // 3b. Attenuation signatures
    for (let i = 0; i < token.attenuations.length; i++) {
        const sigIdx = i + 1;
        if (sigIdx >= token.signatures.length) {
            return { ok: false, error: { type: 'invalid_signature', detail: `Missing signature for attenuation ${i}` } };
        }
        const payload = {
            authority: token.authority,
            attenuations: token.attenuations.slice(0, i + 1),
        };
        if (!verifyObjectSignature(token.attenuations[i].attenuator, payload, token.signatures[sigIdx].signature)) {
            return { ok: false, error: { type: 'invalid_signature', detail: `Attenuation ${i} signature invalid` } };
        }
    }
    // 4. Verify attenuation chain (monotonic narrowing)
    let effectiveCaps = token.authority.capabilities;
    let effectiveBudget = token.authority.maxBudgetMicrocents;
    let effectiveExpiry = token.authority.expiresAt;
    let effectiveMaxDepth = token.authority.maxChainDepth;
    let currentDelegatee = token.authority.delegatee;
    for (let i = 0; i < token.attenuations.length; i++) {
        const att = token.attenuations[i];
        if (att.attenuator !== currentDelegatee) {
            return { ok: false, error: { type: 'attenuation_violation', detail: 'Attenuator mismatch' } };
        }
        if (att.allowedCapabilities) {
            for (const cap of att.allowedCapabilities) {
                if (!isCapabilitySubset(cap, effectiveCaps)) {
                    return { ok: false, error: { type: 'attenuation_violation', detail: 'Capability expansion' } };
                }
            }
            effectiveCaps = att.allowedCapabilities;
        }
        if (att.maxBudgetMicrocents !== undefined) {
            if (att.maxBudgetMicrocents > effectiveBudget) {
                return { ok: false, error: { type: 'attenuation_violation', detail: 'Budget expansion' } };
            }
            effectiveBudget = att.maxBudgetMicrocents;
        }
        if (att.expiresAt !== undefined) {
            if (att.expiresAt > effectiveExpiry) {
                return { ok: false, error: { type: 'attenuation_violation', detail: 'Expiry expansion' } };
            }
            effectiveExpiry = att.expiresAt;
        }
        if (att.maxChainDepth !== undefined) {
            if (att.maxChainDepth >= effectiveMaxDepth) {
                return { ok: false, error: { type: 'attenuation_violation', detail: 'Chain depth expansion' } };
            }
            effectiveMaxDepth = att.maxChainDepth;
        }
        currentDelegatee = att.delegatee;
    }
    // 5. Check chain depth limit
    const actualDepth = token.authority.chainDepth + token.attenuations.length;
    const depthLimit = context.maxChainDepth ?? 10;
    if (actualDepth > depthLimit) {
        return { ok: false, error: { type: 'chain_depth_exceeded', max: depthLimit, actual: actualDepth } };
    }
    // 6. Check expiry
    if (context.now > effectiveExpiry) {
        return { ok: false, error: { type: 'expired' } };
    }
    // 7. Check budget
    if (context.spentMicrocents >= effectiveBudget) {
        return { ok: false, error: { type: 'budget_exceeded', limit: effectiveBudget, spent: context.spentMicrocents } };
    }
    // 8. Check capability (including namespace)
    const requestedNamespace = context.namespace ?? '';
    // Try to match any capability
    const matched = effectiveCaps.some(cap => matchCapability(cap, requestedNamespace, context.operation, context.resource));
    if (!matched) {
        return {
            ok: false,
            error: {
                type: 'capability_not_granted',
                requested: { namespace: requestedNamespace || '*', action: context.operation, resource: context.resource },
                granted: effectiveCaps,
            },
        };
    }
    // 9. Return authorized scope
    const lastContractId = token.attenuations.length > 0
        ? token.attenuations[token.attenuations.length - 1].contractId
        : token.authority.contractId;
    const lastDelegationId = token.attenuations.length > 0
        ? token.attenuations[token.attenuations.length - 1].delegationId
        : token.authority.delegationId;
    return {
        ok: true,
        value: {
            capabilities: effectiveCaps,
            remainingBudgetMicrocents: effectiveBudget - context.spentMicrocents,
            chainDepth: token.authority.chainDepth + token.attenuations.length,
            maxChainDepth: effectiveMaxDepth,
            contractId: lastContractId,
            delegationId: lastDelegationId,
        },
    };
}
/**
 * Inspect a DCT without verifying signatures.
 * @param serialized - The serialized DCT
 * @returns Token metadata
 */
export function inspectDCT(serialized) {
    const token = deserialize(serialized);
    const effective = computeEffective(token);
    const lastDelegatee = token.attenuations.length > 0
        ? token.attenuations[token.attenuations.length - 1].delegatee
        : token.authority.delegatee;
    const lastContractId = token.attenuations.length > 0
        ? token.attenuations[token.attenuations.length - 1].contractId
        : token.authority.contractId;
    const lastDelegationId = token.attenuations.length > 0
        ? token.attenuations[token.attenuations.length - 1].delegationId
        : token.authority.delegationId;
    return {
        issuer: token.authority.issuer,
        delegatee: lastDelegatee,
        contractId: lastContractId,
        delegationId: lastDelegationId,
        capabilities: effective.capabilities,
        expiresAt: effective.expiresAt,
        chainDepth: token.authority.chainDepth + token.attenuations.length,
        revocationIds: getRevocationIds(serialized),
    };
}
/**
 * Get all revocation IDs for a token (one per block).
 * @param serialized - The serialized DCT
 * @returns Array of revocation IDs
 */
export function getRevocationIds(serialized) {
    const token = deserialize(serialized);
    const ids = [computeRevocationId(token.authority)];
    for (const att of token.attenuations) {
        ids.push(computeRevocationId(att));
    }
    return ids;
}
// ── Internal helpers ──
function serialize(token) {
    const json = canonicalize(token);
    const bytes = new TextEncoder().encode(json);
    return { token: toBase64url(bytes), format: 'delegateos-sjt-v1' };
}
function deserialize(serialized) {
    if (serialized.format !== 'delegateos-sjt-v1') {
        throw new Error(`Unsupported format: ${serialized.format}`);
    }
    const bytes = fromBase64url(serialized.token);
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json);
}
function computeRevocationId(block) {
    const payload = new TextEncoder().encode(canonicalize(block));
    return toBase64url(blake2b256(payload));
}
function computeEffective(token) {
    let capabilities = token.authority.capabilities;
    let budget = token.authority.maxBudgetMicrocents;
    let expiresAt = token.authority.expiresAt;
    let maxChainDepth = token.authority.maxChainDepth;
    for (const att of token.attenuations) {
        if (att.allowedCapabilities)
            capabilities = att.allowedCapabilities;
        if (att.maxBudgetMicrocents !== undefined)
            budget = att.maxBudgetMicrocents;
        if (att.expiresAt !== undefined)
            expiresAt = att.expiresAt;
        if (att.maxChainDepth !== undefined)
            maxChainDepth = att.maxChainDepth;
    }
    return { capabilities, budget, expiresAt, maxChainDepth };
}
/** Check if a single capability is a subset of any in the list */
function isCapabilitySubset(cap, parentCaps) {
    return parentCaps.some(parent => parent.namespace === cap.namespace &&
        parent.action === cap.action &&
        isResourceSubset(cap.resource, parent.resource));
}
/** Conservative resource subset check for v0.1 */
function isResourceSubset(child, parent) {
    if (parent === '*' || parent === '**')
        return true;
    if (child === parent)
        return true;
    // Parent ends with /** and child starts with the prefix
    if (parent.endsWith('/**')) {
        const prefix = parent.slice(0, -3);
        if (child.startsWith(prefix))
            return true;
    }
    // Parent ends with /* and child is one level deeper
    if (parent.endsWith('/*')) {
        const prefix = parent.slice(0, -2);
        if (child.startsWith(prefix) && !child.slice(prefix.length).includes('/'))
            return true;
    }
    return false;
}
/** Check if a capability matches a namespace+operation+resource request */
function matchCapability(cap, namespace, operation, resource) {
    if (namespace && cap.namespace !== namespace && cap.namespace !== '*')
        return false;
    if (cap.action !== operation && cap.action !== '*')
        return false;
    return matchGlob(cap.resource, resource);
}
/** Simple glob matching: * = one segment, ** = any segments */
function matchGlob(pattern, value) {
    if (pattern === '*' || pattern === '**')
        return true;
    if (pattern === value)
        return true;
    const patParts = pattern.split('/');
    const valParts = value.split('/');
    let pi = 0;
    let vi = 0;
    while (pi < patParts.length && vi < valParts.length) {
        if (patParts[pi] === '**') {
            // ** at end matches everything
            if (pi === patParts.length - 1)
                return true;
            // Try matching rest from every position
            for (let k = vi; k <= valParts.length; k++) {
                if (matchGlob(patParts.slice(pi + 1).join('/'), valParts.slice(k).join('/')))
                    return true;
            }
            return false;
        }
        if (patParts[pi] === '*' || patParts[pi] === valParts[vi]) {
            pi++;
            vi++;
        }
        else {
            return false;
        }
    }
    return pi === patParts.length && vi === valParts.length;
}
export { deserialize as _deserialize, serialize as _serialize, matchGlob as _matchGlob };
