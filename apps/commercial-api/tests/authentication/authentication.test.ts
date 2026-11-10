import { describe, expect, it } from "vitest";

import { authenticate, type AuthenticationAdapter } from "../../src/authentication/authenticationAdapter.js";
import { AuthenticationError } from "../../src/authentication/authenticationError.js";
import { authorizationHeaderValues, parseBearerCredential } from "../../src/authentication/bearerCredential.js";
import { createVerifiedIdentity, type VerifiedIdentity } from "../../src/authentication/verifiedIdentity.js";
import type { VerifiedIdentity as ProvisioningIdentity } from "../../src/provisioning/provisionPersonalAccountForIdentity.js";
import { createTestIdentityProvider, type TestCredentialFixture } from "../support/testIdentityProvider.js";

const ISSUER = "https://issuer.auth.test/";
const TOKEN_ALICE = "fixture-token-alice";
const TOKEN_BOB = "fixture-token-bob";

const alice: VerifiedIdentity = { issuer: ISSUER, subject: "Subject-Alice", email: { address: "shared@example.test", verified: true } };
const bob: VerifiedIdentity = { issuer: ISSUER, subject: "subject-bob", email: { address: "shared@example.test", verified: false } };

const bearer = (token: string) => [`Bearer ${token}`];

async function expectAuthError(promise: Promise<unknown>, code: string, secrets: readonly string[] = []) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AuthenticationError);
  expect((caught as AuthenticationError).code).toBe(code);
  const visible = `${(caught as Error).message} ${JSON.stringify(caught)}`;
  for (const secret of secrets) {
    expect(visible).not.toContain(secret);
  }
}

function provider(fixtures: readonly TestCredentialFixture[], options?: Parameters<typeof createTestIdentityProvider>[1]) {
  return createTestIdentityProvider(fixtures, options);
}

describe("verified identity contract", () => {
  it("is the same type the provisioning service accepts", () => {
    const identity: ProvisioningIdentity = createVerifiedIdentity(alice);
    expect(identity).toEqual(alice);
  });

  it("keeps issuer and subject exactly, with no trimming or case folding", () => {
    const identity = createVerifiedIdentity({ issuer: " https://Issuer.Test/ ", subject: " Mixed-Case-Subjecté " });
    expect(identity.issuer).toBe(" https://Issuer.Test/ ");
    expect(identity.subject).toBe(" Mixed-Case-Subjecté ");
  });

  it("returns a frozen identity, including the email attribute", () => {
    const identity = createVerifiedIdentity(alice);
    expect(Object.isFrozen(identity)).toBe(true);
    expect(Object.isFrozen(identity.email)).toBe(true);
  });

  it.each([
    ["userId", { ...alice, userId: "00000000-0000-4000-8000-000000000000" }],
    ["accountId", { ...alice, accountId: "a" }],
    ["grantId", { ...alice, grantId: "g" }],
    ["role", { ...alice, role: "OWNER" }],
    ["plan", { ...alice, plan: "CREATOR" }],
    ["tier", { ...alice, tier: "PRO" }],
    ["entitlement", { ...alice, entitlement: "FREE_BYO" }],
    ["ownership", { ...alice, productionIds: [] }],
    ["an extra email field", { ...alice, email: { address: "a@example.test", verified: true, primary: true } }],
    ["an email without its verified flag", { issuer: ISSUER, subject: "s", email: { address: "a@example.test" } }],
    ["a blank subject", { issuer: ISSUER, subject: "  " }],
    ["a missing issuer", { subject: "s" }],
    ["an overlong subject", { issuer: ISSUER, subject: "s".repeat(256) }],
  ])("rejects claims carrying %s", (_label, claims) => {
    expect(() => createVerifiedIdentity(claims)).toThrow(AuthenticationError);
  });
});

describe("bearer credential transport", () => {
  it("accepts exactly one Bearer credential with a case-insensitive scheme", () => {
    for (const scheme of ["Bearer", "bearer", "BEARER", "bEaReR"]) {
      expect(parseBearerCredential([`${scheme} abc.DEF-ghi_jkl~mno+pqr/stu==`])).toEqual({ scheme: "bearer", token: "abc.DEF-ghi_jkl~mno+pqr/stu==" });
    }
  });

  it("collects every Authorization value from raw headers so duplicates are visible", () => {
    expect(authorizationHeaderValues(["Host", "x", "Authorization", "Bearer a", "authorization", "Bearer b"])).toEqual(["Bearer a", "Bearer b"]);
  });

  it("treats an absent credential as AUTHENTICATION_REQUIRED, never as anonymous", () => {
    let caught: unknown;
    try {
      parseBearerCredential([]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AuthenticationError);
    expect((caught as AuthenticationError).code).toBe("AUTHENTICATION_REQUIRED");
  });

  it.each([
    ["duplicate values", ["Bearer one", "Bearer two"]],
    ["an empty value", [""]],
    ["a scheme only", ["Bearer"]],
    ["a scheme and blank", ["Bearer   "]],
    ["an unsupported scheme", ["Basic dXNlcjpwYXNz"]],
    ["a token with spaces", ["Bearer one two"]],
    ["a token with forbidden characters", ["Bearer abc$def"]],
    ["an identity-shaped value", ["Bearer issuer:subject:email"]],
    ["JSON instead of a token", ['Bearer {"sub":"x"}']],
    ["a leading space", [" Bearer token"]],
    ["an oversized token", [`Bearer ${"a".repeat(4097)}`]],
  ])("rejects %s as AUTHENTICATION_MALFORMED without echoing it", (_label, values) => {
    let caught: unknown;
    try {
      parseBearerCredential(values);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "AUTHENTICATION_MALFORMED" });
    for (const value of values) {
      if (value.trim().length > 0) expect((caught as Error).message).not.toContain(value.trim());
    }
  });
});

describe("authenticate with the test identity provider", () => {
  const fixtures: TestCredentialFixture[] = [
    { token: TOKEN_ALICE, identity: alice },
    { token: TOKEN_BOB, identity: bob },
  ];

  it("resolves a valid opaque credential to the exact configured identity", async () => {
    const identity = await authenticate(provider(fixtures), bearer(TOKEN_ALICE));
    expect(identity).toEqual(alice);
    expect(Object.isFrozen(identity)).toBe(true);
  });

  it("returns no token material and no internal or authority fields", async () => {
    const identity = await authenticate(provider(fixtures), bearer(TOKEN_ALICE));
    expect(Object.keys(identity).sort()).toEqual(["email", "issuer", "subject"]);
    expect(JSON.stringify(identity)).not.toContain(TOKEN_ALICE);
    for (const field of ["userId", "accountId", "grantId", "role", "plan", "tier", "entitlement"]) {
      expect(identity).not.toHaveProperty(field);
    }
  });

  it("keeps identities that share an email distinct, with their own verified flags", async () => {
    const adapter = provider(fixtures);
    const a = await authenticate(adapter, bearer(TOKEN_ALICE));
    const b = await authenticate(adapter, bearer(TOKEN_BOB));
    expect(a.email?.address).toBe(b.email?.address);
    expect(a.subject).not.toBe(b.subject);
    expect(a.email?.verified).toBe(true);
    expect(b.email?.verified).toBe(false);
  });

  it("keeps the same subject under different issuers distinct", async () => {
    const adapter = provider([
      { token: "issuer-one", identity: { issuer: "https://one.auth.test", subject: "same" } },
      { token: "issuer-two", identity: { issuer: "https://two.auth.test", subject: "same" } },
    ]);
    const one = await authenticate(adapter, bearer("issuer-one"));
    const two = await authenticate(adapter, bearer("issuer-two"));
    expect([one.issuer, one.subject]).toEqual(["https://one.auth.test", "same"]);
    expect([two.issuer, two.subject]).toEqual(["https://two.auth.test", "same"]);
  });

  it("supports identities with no email", async () => {
    const identity = await authenticate(provider([{ token: "no-email", identity: { issuer: ISSUER, subject: "no-email" } }]), bearer("no-email"));
    expect(identity).toEqual({ issuer: ISSUER, subject: "no-email" });
    expect(identity).not.toHaveProperty("email");
  });

  it("keeps issuer and subject exact through the whole boundary", async () => {
    const exact = { issuer: "HTTPS://Issuer.Auth.Test/Path/", subject: "CaseSensitive-ID-Å" };
    const identity = await authenticate(provider([{ token: "exact", identity: exact }]), bearer("exact"));
    expect(identity).toEqual(exact);
  });

  it("rejects an unknown credential without echoing it", async () => {
    await expectAuthError(authenticate(provider(fixtures), bearer("unknown-token-value")), "AUTHENTICATION_INVALID", ["unknown-token-value"]);
  });

  it("rejects an expired credential", async () => {
    const adapter = provider([{ token: "expiring", identity: alice, expiresAt: new Date("2026-11-10T12:00:00Z") }], {
      now: () => new Date("2026-11-10T12:00:00Z"),
    });
    await expectAuthError(authenticate(adapter, bearer("expiring")), "AUTHENTICATION_EXPIRED", ["expiring", alice.subject]);
  });

  it("accepts a credential before its expiry", async () => {
    const adapter = provider([{ token: "fresh", identity: alice, expiresAt: new Date("2026-11-10T12:00:01Z") }], {
      now: () => new Date("2026-11-10T12:00:00Z"),
    });
    await expect(authenticate(adapter, bearer("fresh"))).resolves.toEqual(alice);
  });

  it("rejects a revoked credential", async () => {
    await expectAuthError(authenticate(provider([{ token: "revoked", identity: alice, status: "revoked" }]), bearer("revoked")), "AUTHENTICATION_REVOKED", [
      "revoked-token",
    ]);
  });

  it("rejects malformed and missing credentials before the adapter runs", async () => {
    let calls = 0;
    const counting: AuthenticationAdapter = {
      verify: async () => {
        calls += 1;
        return alice;
      },
    };
    await expectAuthError(authenticate(counting, []), "AUTHENTICATION_REQUIRED");
    await expectAuthError(authenticate(counting, ["Basic abc"]), "AUTHENTICATION_MALFORMED", ["abc"]);
    await expectAuthError(authenticate(counting, ["Bearer a", "Bearer b"]), "AUTHENTICATION_MALFORMED");
    expect(calls).toBe(0);
  });

  it("cannot be steered by caller-controlled identity: a token is looked up, never parsed", async () => {
    const adapter = provider(fixtures);
    // Variations that embed another identity, or alter Alice's token, do not resolve to anyone.
    for (const forged of [`${TOKEN_ALICE}x`, TOKEN_ALICE.toUpperCase(), "issuer.subject.email", Buffer.from(JSON.stringify(bob)).toString("base64")]) {
      await expectAuthError(authenticate(adapter, bearer(forged)), "AUTHENTICATION_INVALID");
    }
    // Only the Authorization credential is consulted: no other header participates.
    const identity = await authenticate(adapter, authorizationHeaderValues(["X-Account-Id", "evil", "Authorization", `Bearer ${TOKEN_ALICE}`, "X-Role", "OWNER"]));
    expect(identity).toEqual(alice);
  });

  it("fails deterministically on duplicate fixture tokens", () => {
    expect(() =>
      provider([
        { token: "same", identity: alice },
        { token: "same", identity: bob },
      ]),
    ).toThrow("Duplicate test identity fixture token.");
  });

  it("refuses fixtures whose identities break the contract", () => {
    expect(() => provider([{ token: "bad", identity: { ...alice, role: "OWNER" } as unknown as VerifiedIdentity }])).toThrow(AuthenticationError);
  });

  it("does not let later mutation of a fixture alter the trusted identity", async () => {
    const mutable = { issuer: ISSUER, subject: "original" };
    const adapter = provider([{ token: "mutable", identity: mutable }]);
    mutable.subject = "changed";
    await expect(authenticate(adapter, bearer("mutable"))).resolves.toEqual({ issuer: ISSUER, subject: "original" });
  });

  it("reports a verifier outage as AUTHENTICATION_UNAVAILABLE and keeps the fault only as cause", async () => {
    const adapter = provider(fixtures, { available: () => false });
    let caught: unknown;
    try {
      await authenticate(adapter, bearer(TOKEN_ALICE));
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "AUTHENTICATION_UNAVAILABLE", message: "Authentication is temporarily unavailable." });
    expect((caught as Error).cause).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain(TOKEN_ALICE);
  });

  it("re-validates adapter output so an adapter cannot pass authority claims onward", async () => {
    const leaky: AuthenticationAdapter = {
      verify: async () => ({ ...alice, accountId: "acct", role: "OWNER", plan: "CREATOR" }) as unknown as VerifiedIdentity,
    };
    await expectAuthError(authenticate(leaky, bearer(TOKEN_ALICE)), "AUTHENTICATION_UNAVAILABLE");

    const internalId: AuthenticationAdapter = {
      verify: async () => ({ ...alice, userId: "00000000-0000-4000-8000-000000000000" }) as unknown as VerifiedIdentity,
    };
    await expectAuthError(authenticate(internalId, bearer(TOKEN_ALICE)), "AUTHENTICATION_UNAVAILABLE");
  });

  it("proves only the external identity: it knows nothing of BusyBookie users or account activity", async () => {
    // The adapter has no database and no account state; a disabled BusyBookie
    // user still authenticates here. Refusal is the application's job after
    // authentication (provisioning and production services refuse disabled
    // users and accounts).
    const identity = await authenticate(provider(fixtures), bearer(TOKEN_ALICE));
    expect(identity).not.toHaveProperty("status");
    expect(identity).not.toHaveProperty("active");
  });

  it("uses fixed, generic error messages for every code", () => {
    const messages = (["AUTHENTICATION_REQUIRED", "AUTHENTICATION_MALFORMED", "AUTHENTICATION_INVALID", "AUTHENTICATION_EXPIRED", "AUTHENTICATION_REVOKED", "AUTHENTICATION_UNAVAILABLE"] as const).map(
      (code) => new AuthenticationError(code).message,
    );
    expect(new Set(messages).size).toBe(6);
    for (const message of messages) {
      expect(message).not.toMatch(/token|bearer|issuer|subject|@/i);
    }
  });
});
