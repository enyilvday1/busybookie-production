import {
  GOOGLE_EXPECTED_COST_CAP_UNIT,
  GOOGLE_MODEL,
  GOOGLE_PROVIDER_ID,
  parseGoogleGenerationRequest,
  parseRunwayGenerationRequest,
  RUNWAY_EXPECTED_COST_CAP_UNIT,
  RUNWAY_MODEL,
  RUNWAY_PROVIDER_ID,
  type GoogleGenerationRequest,
  type RunwayGenerationRequest,
} from "commercial-worker-protocol";

import { GenerationAuthorizationError } from "./generationAuthorizationError.js";

// Source-controlled generation-authority policy (R44B11C;
// docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md, "USER_BYO
// generation-authorization issuance"). Separate from the FREE_BYO entitlement
// policy and from the ProviderConnection-creation capability registry.
//
// The shared R44B11A contract stays the only request grammar, provider/model
// identity, cost-unit and canonical-hash authority: this module only selects
// the shared parser and unit for an exact provider/model pair. A capability
// entry supplies a policy version, a claim lifetime and an expected-cost
// amount policy; it cannot supply a validator, canonicalizer or cost unit.
// Nothing here reads the environment, the request input, a worker or a
// provider response.

export type ValidatedGenerationRequest = GoogleGenerationRequest | RunwayGenerationRequest;

export type SharedGenerationContract = Readonly<{
  provider: string;
  model: string;
  expectedCostCapUnit: string;
  parse: (value: unknown) => ValidatedGenerationRequest;
}>;

// The exact shared provider/model pairs, their parsers and their cost units.
const SHARED_GENERATION_CONTRACTS: readonly SharedGenerationContract[] = Object.freeze([
  Object.freeze({
    provider: GOOGLE_PROVIDER_ID,
    model: GOOGLE_MODEL,
    expectedCostCapUnit: GOOGLE_EXPECTED_COST_CAP_UNIT,
    parse: parseGoogleGenerationRequest,
  }),
  Object.freeze({
    provider: RUNWAY_PROVIDER_ID,
    model: RUNWAY_MODEL,
    expectedCostCapUnit: RUNWAY_EXPECTED_COST_CAP_UNIT,
    parse: parseRunwayGenerationRequest,
  }),
]);

// Exact match only: no case folding, prefix or alias.
export function sharedGenerationContract(provider: string, model: string): SharedGenerationContract | null {
  return SHARED_GENERATION_CONTRACTS.find((contract) => contract.provider === provider && contract.model === model) ?? null;
}

export type GenerationCapability = Readonly<{
  // Versioned identifier of the reviewed policy; recorded in issuance audit.
  generationPolicyVersion: string;
  provider: string;
  model: string;
  // Whole seconds from database-server time to the authorization's expiry.
  claimLifetimeSeconds: number;
  // Pure: a positive safe-integer execution safety ceiling, in the shared
  // contract's cost unit, for an already validated request. Not a charge.
  expectedCostAmount: (request: ValidatedGenerationRequest) => number;
}>;

export type GenerationAuthorityPolicyRegistry = Readonly<{
  // The enabled capability for exactly this provider and model, or null.
  resolve: (provider: string, model: string) => GenerationCapability | null;
}>;

export type GenerationLimits = Readonly<{
  generationPolicyVersion: string;
  claimLifetimeSeconds: number;
  expectedCostCapUnit: string;
  expectedCostCapAmount: number;
}>;

const POLICY_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const CAPABILITY_KEYS = new Set(["generationPolicyVersion", "provider", "model", "claimLifetimeSeconds", "expectedCostAmount"]);

const policyInvalid = () => new GenerationAuthorizationError("GENERATION_POLICY_INVALID");
const isPositiveSafeInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

// The locked capability shape, checked whenever a capability is registered or
// used, so a hand-built registry cannot bypass it.
function checkedCapability(entry: unknown): GenerationCapability {
  if (typeof entry !== "object" || entry === null || Object.keys(entry).some((key) => !CAPABILITY_KEYS.has(key))) throw policyInvalid();
  const { generationPolicyVersion, provider, model, claimLifetimeSeconds, expectedCostAmount } = entry as Record<string, unknown>;
  if (typeof generationPolicyVersion !== "string" || !POLICY_VERSION_PATTERN.test(generationPolicyVersion)) throw policyInvalid();
  if (typeof provider !== "string" || typeof model !== "string" || sharedGenerationContract(provider, model) === null) throw policyInvalid();
  if (!isPositiveSafeInteger(claimLifetimeSeconds)) throw policyInvalid();
  if (typeof expectedCostAmount !== "function") throw policyInvalid();
  return Object.freeze({
    generationPolicyVersion,
    provider,
    model,
    claimLifetimeSeconds,
    expectedCostAmount: expectedCostAmount as GenerationCapability["expectedCostAmount"],
  });
}

// Builds an immutable registry, failing closed on any malformed entry or a
// duplicate provider/model pair.
export function createGenerationAuthorityPolicyRegistry(capabilities: readonly GenerationCapability[]): GenerationAuthorityPolicyRegistry {
  const entries = new Map<string, GenerationCapability>();
  for (const capability of capabilities) {
    const checked = checkedCapability(capability);
    const key = JSON.stringify([checked.provider, checked.model]);
    if (entries.has(key)) throw policyInvalid();
    entries.set(key, checked);
  }
  return Object.freeze({
    resolve: (provider: string, model: string) => entries.get(JSON.stringify([provider, model])) ?? null,
  });
}

// The production registry. R44B11C enables no provider/model: enabling one
// needs a reviewed policy revision with its numeric claim lifetime and
// expected-cost policy. Tests inject explicit capabilities instead.
export const PRODUCTION_GENERATION_AUTHORITY_POLICY_REGISTRY: GenerationAuthorityPolicyRegistry = createGenerationAuthorityPolicyRegistry([]);

// Re-checks a resolved capability against the exact pair it was resolved for.
// The parser and cost unit always come from the shared contract, never from
// the capability or the registry.
export function capabilityFor(
  registry: GenerationAuthorityPolicyRegistry,
  provider: string,
  model: string,
): Readonly<{ capability: GenerationCapability; contract: SharedGenerationContract }> | null {
  const resolved = registry.resolve(provider, model);
  if (resolved === null || resolved === undefined) return null;
  const capability = checkedCapability(resolved);
  if (capability.provider !== provider || capability.model !== model) throw policyInvalid();
  const contract = sharedGenerationContract(provider, model);
  if (contract === null) throw policyInvalid();
  return Object.freeze({ capability, contract });
}

// Evaluates a capability for a request already validated by `contract`,
// failing closed: the amount must be a positive safe integer and the unit is
// always the shared contract's.
export function generationLimits(
  capability: GenerationCapability,
  contract: SharedGenerationContract,
  request: ValidatedGenerationRequest,
): GenerationLimits {
  let amount: unknown;
  try {
    amount = capability.expectedCostAmount(request);
  } catch {
    throw policyInvalid();
  }
  if (!isPositiveSafeInteger(amount)) throw policyInvalid();
  return Object.freeze({
    generationPolicyVersion: capability.generationPolicyVersion,
    claimLifetimeSeconds: capability.claimLifetimeSeconds,
    expectedCostCapUnit: contract.expectedCostCapUnit,
    expectedCostCapAmount: amount,
  });
}
