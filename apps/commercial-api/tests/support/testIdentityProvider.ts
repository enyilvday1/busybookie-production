import type { AuthenticationAdapter } from "../../src/authentication/authenticationAdapter.js";
import { AuthenticationError } from "../../src/authentication/authenticationError.js";
import type { AuthenticationCredential } from "../../src/authentication/bearerCredential.js";
import { createVerifiedIdentity, type VerifiedIdentity } from "../../src/authentication/verifiedIdentity.js";

// TEST FIXTURE ONLY. Lives in the test tree, which production source cannot
// import (the boundary test requires every relative import to stay inside
// src). Tokens are opaque fixture keys, not secrets: a token is only looked
// up, never parsed, so nothing in it can choose or alter the identity it maps
// to. Identities are defined server-side by the test at construction.

export type TestCredentialFixture = Readonly<{
  token: string;
  identity: VerifiedIdentity;
  // Defaults to "active".
  status?: "active" | "revoked";
  // When set, the credential is expired at or after this instant.
  expiresAt?: Date;
}>;

export type TestIdentityProviderOptions = Readonly<{
  now?: () => Date;
  // Simulates a verifier outage.
  available?: () => boolean;
}>;

type Entry = Readonly<{ identity: VerifiedIdentity; status: "active" | "revoked"; expiresAt: Date | null }>;

export function createTestIdentityProvider(
  fixtures: readonly TestCredentialFixture[],
  options: TestIdentityProviderOptions = {},
): AuthenticationAdapter {
  const now = options.now ?? (() => new Date());
  const available = options.available ?? (() => true);
  const entries = new Map<string, Entry>();

  for (const fixture of fixtures) {
    if (typeof fixture.token !== "string" || fixture.token === "") {
      throw new Error("Test identity fixtures need a non-empty token.");
    }
    if (entries.has(fixture.token)) {
      // Never silently choose one of two definitions.
      throw new Error("Duplicate test identity fixture token.");
    }
    entries.set(fixture.token, {
      identity: createVerifiedIdentity(fixture.identity),
      status: fixture.status ?? "active",
      expiresAt: fixture.expiresAt ?? null,
    });
  }

  return Object.freeze({
    verify: async (credential: AuthenticationCredential): Promise<VerifiedIdentity> => {
      if (!available()) {
        throw new Error("test identity provider is unavailable");
      }
      const entry = entries.get(credential.token);
      if (entry === undefined) {
        throw new AuthenticationError("AUTHENTICATION_INVALID");
      }
      if (entry.status === "revoked") {
        throw new AuthenticationError("AUTHENTICATION_REVOKED");
      }
      if (entry.expiresAt !== null && now().getTime() >= entry.expiresAt.getTime()) {
        throw new AuthenticationError("AUTHENTICATION_EXPIRED");
      }
      return entry.identity;
    },
  });
}
