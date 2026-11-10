import { AuthenticationError } from "./authenticationError.js";
import { parseBearerCredential, type AuthenticationCredential } from "./bearerCredential.js";
import { createVerifiedIdentity, type VerifiedIdentity } from "./verifiedIdentity.js";

// Server-side verification of an opaque credential at an external identity
// provider. An implementation performs the provider's equivalent of
// signature, issuer, audience, expiry and revocation checks, then returns the
// verified external identity, or rejects with an AuthenticationError.
//
// An adapter knows nothing of PostgreSQL, BusyBookie users or accounts,
// provisioning, entitlements, productions or generation-provider
// credentials. Its responsibility ends at the external identity.
//
// No production adapter exists yet: the identity-provider vendor is not
// selected. Tests use a fixture adapter that lives only in the test tree.
export type AuthenticationAdapter = Readonly<{
  verify: (credential: AuthenticationCredential) => Promise<VerifiedIdentity>;
}>;

// The authentication boundary for a request: parse exactly one bearer
// credential, verify it with the adapter, and return a freshly validated,
// frozen identity.
//
// Whatever the adapter returns is re-validated against the identity contract,
// so an adapter cannot pass an internal ID, role, plan or entitlement claim
// onward; such output is treated as a verifier fault. Any non-authentication
// failure inside the adapter becomes AUTHENTICATION_UNAVAILABLE with the
// original kept only as `cause`.
//
// A successful result proves only who the caller is externally. Whether the
// BusyBookie User and Account exist and are active is decided afterwards by
// the application layer, not here.
export async function authenticate(adapter: AuthenticationAdapter, authorizationValues: readonly string[]): Promise<VerifiedIdentity> {
  const credential = parseBearerCredential(authorizationValues);

  let claims: unknown;
  try {
    claims = await adapter.verify(credential);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw error;
    }
    throw new AuthenticationError("AUTHENTICATION_UNAVAILABLE", { cause: error });
  }

  try {
    return createVerifiedIdentity(claims);
  } catch (error) {
    throw new AuthenticationError("AUTHENTICATION_UNAVAILABLE", { cause: error });
  }
}
