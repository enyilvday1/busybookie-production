// Versioned FREE_BYO entitlement policies. A grant records the policy version
// it was issued under; that version, never the caller and never "the current
// policy", decides what the grant authorises. Unknown versions resolve to
// null and must fail closed.

export type FreeByoPolicy = Readonly<{
  version: string;
  // Productions that may ever be created under one grant, archived ones included.
  maxProductions: number;
}>;

const FREE_BYO_POLICIES: ReadonlyMap<string, FreeByoPolicy> = new Map([
  ["free-byo-v1", Object.freeze({ version: "free-byo-v1", maxProductions: 1 })],
]);

export function resolveFreeByoPolicy(policyVersion: string): FreeByoPolicy | null {
  return FREE_BYO_POLICIES.get(policyVersion) ?? null;
}
