import { randomBytes, randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ASSOCIATED_DATA_FORMAT_V1,
  encodeAssociatedData,
  MAX_CREDENTIAL_VERSION,
  PROVIDER_CREDENTIAL_PURPOSE,
  validateSealingContext,
  type CredentialSealingContext,
} from "../../src/providerCredentials/credentialContext.js";
import { CredentialCryptoError } from "../../src/providerCredentials/credentialCryptoError.js";
import { credentialBytes, MAX_CREDENTIAL_BYTES } from "../../src/providerCredentials/credentialInput.js";
import { MAX_KEY_REF_LENGTH, NONCE_BYTES, parseSealedEnvelope, TAG_BYTES, type SealedCredentialEnvelope } from "../../src/providerCredentials/sealedEnvelope.js";
import {
  createTestCredentialFingerprinter,
  createTestCredentialOpener,
  createTestCredentialSealer,
  generateTestKey,
} from "../support/testCredentialCrypto.js";

// Generated per run: never a real provider credential.
const SECRET = `fixture-secret-${randomBytes(12).toString("hex")}`;

const context = (overrides: Partial<Record<keyof CredentialSealingContext, unknown>> = {}): CredentialSealingContext =>
  ({
    accountId: "0a1b2c3d-0000-4000-8000-000000000001",
    providerConnectionId: "0a1b2c3d-0000-4000-8000-000000000002",
    provider: "EXAMPLE_PROVIDER",
    credentialVersion: 1,
    purpose: PROVIDER_CREDENTIAL_PURPOSE,
    ...overrides,
  }) as CredentialSealingContext;

function cryptoSet() {
  const encryptionKey = generateTestKey("test-encryption-key/v1");
  const fingerprintKey = generateTestKey("test-fingerprint-key/v1");
  return {
    encryptionKey,
    sealer: createTestCredentialSealer(encryptionKey),
    opener: createTestCredentialOpener(encryptionKey),
    fingerprinter: createTestCredentialFingerprinter(fingerprintKey, encryptionKey),
  };
}

async function expectCode(promise: Promise<unknown> | (() => unknown), code: string) {
  let caught: unknown;
  try {
    await (typeof promise === "function" ? promise() : promise);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(CredentialCryptoError);
  expect((caught as CredentialCryptoError).code).toBe(code);
  const visible = `${(caught as Error).message} ${JSON.stringify(caught)} ${String(caught)}`;
  expect(visible).not.toContain(SECRET);
  return caught as CredentialCryptoError;
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
function flipFirstByte(value: string): string {
  const bytes = Buffer.from(value, "base64url");
  bytes[0] = bytes[0]! ^ 0x01;
  return bytes.toString("base64url");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sealing context", () => {
  it("accepts an exact valid context and returns a frozen copy", () => {
    const input = { ...context() };
    const validated = validateSealingContext(input);
    expect(validated).toEqual(input);
    expect(validated).not.toBe(input);
    expect(Object.isFrozen(validated)).toBe(true);
  });

  it.each([
    ["a malformed account UUID", { accountId: "not-a-uuid" }],
    ["an uppercase UUID (non-canonical)", { accountId: "0A1B2C3D-0000-4000-8000-000000000001" }],
    ["a malformed connection UUID", { providerConnectionId: "1234" }],
    ["a blank provider", { provider: "" }],
    ["a lowercase provider", { provider: "example" }],
    ["a provider with spaces", { provider: "EXAMPLE PROVIDER" }],
    ["an oversized provider", { provider: `P${"X".repeat(32)}` }],
    ["credential version 0", { credentialVersion: 0 }],
    ["a negative version", { credentialVersion: -1 }],
    ["a non-integer version", { credentialVersion: 1.5 }],
    ["an oversized version", { credentialVersion: MAX_CREDENTIAL_VERSION + 1 }],
    ["a string version", { credentialVersion: "1" }],
    ["another purpose", { purpose: "session-token" }],
  ])("rejects %s", (_label, overrides) => {
    expect(() => validateSealingContext(context(overrides))).toThrow(CredentialCryptoError);
  });

  it("rejects extra and missing keys", () => {
    expect(() => validateSealingContext({ ...context(), userId: randomUUID() })).toThrow(CredentialCryptoError);
    const { provider: _omitted, ...missing } = context();
    expect(() => validateSealingContext(missing)).toThrow(CredentialCryptoError);
    expect(() => validateSealingContext(null)).toThrow(CredentialCryptoError);
  });

  it("encodes associated data canonically, deterministically and without secrets", () => {
    const encoded = new TextDecoder().decode(encodeAssociatedData(context()));
    expect(encoded).toBe(
      [
        ASSOCIATED_DATA_FORMAT_V1,
        "purpose=provider-credential",
        "account=0a1b2c3d-0000-4000-8000-000000000001",
        "connection=0a1b2c3d-0000-4000-8000-000000000002",
        "provider=EXAMPLE_PROVIDER",
        "credential-version=1",
        "",
      ].join("\n"),
    );
    // Key order of the caller's object does not matter.
    const reordered = { credentialVersion: 1, purpose: PROVIDER_CREDENTIAL_PURPOSE, provider: "EXAMPLE_PROVIDER", providerConnectionId: context().providerConnectionId, accountId: context().accountId };
    expect(Buffer.from(encodeAssociatedData(reordered as CredentialSealingContext))).toEqual(Buffer.from(encodeAssociatedData(context())));
    expect(Buffer.from(encodeAssociatedData(context({ credentialVersion: 2 })))).not.toEqual(Buffer.from(encodeAssociatedData(context())));
  });
});

describe("credential input", () => {
  it("preserves the exact credential, including whitespace and case", () => {
    for (const value of [SECRET, ` ${SECRET}`, `${SECRET}\n`, SECRET.toUpperCase(), "Mixed Case Value", "é"]) {
      expect(new TextDecoder().decode(credentialBytes(value))).toBe(value);
    }
  });

  it("does not Unicode-normalise", () => {
    expect(Buffer.from(credentialBytes("é"))).not.toEqual(Buffer.from(credentialBytes("é")));
  });

  it.each([
    ["an empty string", ""],
    ["a non-string", 42],
    ["a NUL character", "abc\u0000def"],
    ["a lone surrogate", "abc\uD800"],
    ["an oversized credential", "x".repeat(MAX_CREDENTIAL_BYTES + 1)],
    ["an oversized multi-byte credential", "é".repeat(MAX_CREDENTIAL_BYTES / 2 + 1)],
  ])("rejects %s", (_label, value) => {
    expect(() => credentialBytes(value)).toThrow(CredentialCryptoError);
  });

  it("accepts exactly the byte bound", () => {
    expect(credentialBytes("x".repeat(MAX_CREDENTIAL_BYTES)).length).toBe(MAX_CREDENTIAL_BYTES);
  });
});

describe("sealing and opening (AES-256-GCM, test implementation)", () => {
  it("round-trips the exact credential under the original context", async () => {
    const { sealer, opener } = cryptoSet();
    for (const value of [SECRET, ` ${SECRET} `, SECRET.toUpperCase(), "é\u{1F600}"]) {
      const envelope = await sealer.seal(value, context());
      await expect(opener.open(envelope, context())).resolves.toBe(value);
    }
  });

  it("produces an envelope with only non-secret metadata and ciphertext", async () => {
    const { sealer } = cryptoSet();
    const envelope = await sealer.seal(SECRET, context());

    expect(Object.keys(envelope).sort()).toEqual(["algorithm", "associatedDataFormat", "ciphertext", "format", "keyRef", "nonce", "tag"]);
    expect(envelope).toMatchObject({
      format: "sealed-credential-v1",
      algorithm: "AES-256-GCM",
      keyRef: "test-encryption-key/v1",
      associatedDataFormat: "provider-credential-context-v1",
    });
    expect(Buffer.from(envelope.nonce, "base64url")).toHaveLength(NONCE_BYTES);
    expect(Buffer.from(envelope.tag, "base64url")).toHaveLength(TAG_BYTES);
    expect(JSON.stringify(envelope)).not.toContain(SECRET);
    expect(Buffer.from(envelope.ciphertext, "base64url").toString("utf8")).not.toContain(SECRET);
    expect(Object.isFrozen(envelope)).toBe(true);
  });

  it("uses a fresh nonce for every seal of the same credential", async () => {
    const { sealer } = cryptoSet();
    const envelopes = await Promise.all(Array.from({ length: 50 }, () => sealer.seal(SECRET, context())));
    expect(new Set(envelopes.map((envelope) => envelope.nonce)).size).toBe(50);
    expect(new Set(envelopes.map((envelope) => envelope.ciphertext)).size).toBe(50);
  });

  it("is deterministic with an injected nonce, without weakening the algorithm", async () => {
    const key = generateTestKey("test-encryption-key/v1");
    const fixedNonce = randomBytes(NONCE_BYTES);
    const sealer = createTestCredentialSealer(key, { nonce: () => fixedNonce });
    const first = await sealer.seal(SECRET, context());
    const second = await sealer.seal(SECRET, context());
    expect(second).toEqual(first);
    await expect(createTestCredentialOpener(key).open(first, context())).resolves.toBe(SECRET);
  });

  it.each([
    ["a different account", { accountId: "0a1b2c3d-0000-4000-8000-0000000000aa" }],
    ["a different connection", { providerConnectionId: "0a1b2c3d-0000-4000-8000-0000000000bb" }],
    ["a different provider", { provider: "OTHER_PROVIDER" }],
    ["a different credential version", { credentialVersion: 2 }],
  ])("fails to open under %s", async (_label, overrides) => {
    const { sealer, opener } = cryptoSet();
    const envelope = await sealer.seal(SECRET, context());
    await expectCode(opener.open(envelope, context(overrides)), "AUTHENTICATION_FAILED");
  });

  it("fails when the context purpose or associated-data version differs", async () => {
    const { sealer, opener } = cryptoSet();
    const envelope = await sealer.seal(SECRET, context());
    await expectCode(opener.open(envelope, context({ purpose: "other-purpose" })), "CONTEXT_INVALID");
    await expectCode(opener.open({ ...envelope, associatedDataFormat: "provider-credential-context-v2" }, context()), "ENVELOPE_UNSUPPORTED");
  });

  it.each([
    ["ciphertext", "ciphertext"],
    ["authentication tag", "tag"],
    ["nonce", "nonce"],
  ] as const)("fails closed when the %s is tampered with", async (_label, field) => {
    const { sealer, opener } = cryptoSet();
    const envelope = await sealer.seal(SECRET, context());
    await expectCode(opener.open({ ...envelope, [field]: flipFirstByte(envelope[field]) }, context()), "AUTHENTICATION_FAILED");
  });

  it("fails closed when the key reference is changed", async () => {
    const { sealer, opener } = cryptoSet();
    const envelope = await sealer.seal(SECRET, context());
    await expectCode(opener.open({ ...envelope, keyRef: "test-encryption-key/v2" }, context()), "AUTHENTICATION_FAILED");
  });

  it("fails with a different key, even under the same key reference", async () => {
    const { sealer } = cryptoSet();
    const envelope = await sealer.seal(SECRET, context());
    const impostor = createTestCredentialOpener(generateTestKey("test-encryption-key/v1"));
    await expectCode(impostor.open(envelope, context()), "AUTHENTICATION_FAILED");
  });

  it("does not change an already sealed envelope when caller objects are mutated", async () => {
    const { sealer, opener } = cryptoSet();
    const mutableContext = { ...context() };
    const envelope = await sealer.seal(SECRET, mutableContext);
    mutableContext.accountId = "0a1b2c3d-0000-4000-8000-0000000000cc";

    await expect(opener.open(envelope, context())).resolves.toBe(SECRET);
    expect(() => {
      (envelope as { ciphertext: string }).ciphertext = "x";
    }).toThrow(TypeError);
  });
});

describe("envelope parsing", () => {
  async function validEnvelope(): Promise<SealedCredentialEnvelope> {
    return cryptoSet().sealer.seal(SECRET, context());
  }

  it.each([
    ["a missing field", (e: SealedCredentialEnvelope) => { const { tag: _omitted, ...rest } = e; return rest; }],
    ["an extra field", (e: SealedCredentialEnvelope) => ({ ...e, plaintext: SECRET })],
    ["an unsupported envelope format", (e: SealedCredentialEnvelope) => ({ ...e, format: "sealed-credential-v2" })],
    ["an unsupported algorithm", (e: SealedCredentialEnvelope) => ({ ...e, algorithm: "AES-128-CBC" })],
    ["an unsupported associated-data format", (e: SealedCredentialEnvelope) => ({ ...e, associatedDataFormat: "v0" })],
    ["invalid base64url", (e: SealedCredentialEnvelope) => ({ ...e, ciphertext: "not base64!" })],
    ["padded base64", (e: SealedCredentialEnvelope) => ({ ...e, nonce: `${e.nonce}==` })],
    ["a short nonce", (e: SealedCredentialEnvelope) => ({ ...e, nonce: b64(randomBytes(8)) })],
    ["a long nonce", (e: SealedCredentialEnvelope) => ({ ...e, nonce: b64(randomBytes(16)) })],
    ["a short tag", (e: SealedCredentialEnvelope) => ({ ...e, tag: b64(randomBytes(12)) })],
    ["an empty ciphertext", (e: SealedCredentialEnvelope) => ({ ...e, ciphertext: "" })],
    ["an oversized ciphertext", (e: SealedCredentialEnvelope) => ({ ...e, ciphertext: b64(randomBytes(MAX_CREDENTIAL_BYTES + 1)) })],
    ["an oversized key reference", (e: SealedCredentialEnvelope) => ({ ...e, keyRef: "k".repeat(MAX_KEY_REF_LENGTH + 1) })],
    ["a key reference with spaces", (e: SealedCredentialEnvelope) => ({ ...e, keyRef: "key ref" })],
    ["a non-string field", (e: SealedCredentialEnvelope) => ({ ...e, nonce: 12 })],
    ["null", () => null],
    ["an array", () => []],
  ])("rejects %s without echoing it", async (_label, mutate) => {
    const envelope = await validEnvelope();
    const error = await expectCode(() => parseSealedEnvelope(mutate(envelope)), "ENVELOPE_UNSUPPORTED");
    expect(error.message).not.toContain(envelope.ciphertext);
    await expectCode(cryptoSet().opener.open(mutate(envelope), context()), "ENVELOPE_UNSUPPORTED");
  });

  it("returns frozen copies of the decoded values", async () => {
    const parsed = parseSealedEnvelope(await validEnvelope());
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.envelope)).toBe(true);
  });
});

describe("fingerprinting (HMAC-SHA-256, test implementation)", () => {
  it("is deterministic for the exact credential and key", async () => {
    const { fingerprinter } = cryptoSet();
    const first = await fingerprinter.fingerprint(SECRET);
    const second = await fingerprinter.fingerprint(SECRET);
    expect(second).toEqual(first);
    expect(first).toMatchObject({ algorithm: "HMAC-SHA-256", keyRef: "test-fingerprint-key/v1" });
    expect(first.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it.each([
    ["a one-byte difference", `${SECRET.slice(0, -1)}${SECRET.endsWith("0") ? "1" : "0"}`],
    ["a leading space", ` ${SECRET}`],
    ["a trailing space", `${SECRET} `],
    ["a trailing newline", `${SECRET}\n`],
    ["a case change", SECRET.toUpperCase()],
  ])("changes with %s (no normalisation)", async (_label, variant) => {
    const { fingerprinter } = cryptoSet();
    expect((await fingerprinter.fingerprint(variant)).value).not.toBe((await fingerprinter.fingerprint(SECRET)).value);
  });

  it("changes with a different fingerprint key", async () => {
    const one = createTestCredentialFingerprinter(generateTestKey("fp/a"));
    const two = createTestCredentialFingerprinter(generateTestKey("fp/b"));
    expect((await one.fingerprint(SECRET)).value).not.toBe((await two.fingerprint(SECRET)).value);
  });

  it("refuses a fingerprint key that is also an encryption key", () => {
    const shared = generateTestKey("shared/v1");
    expect(() => createTestCredentialFingerprinter(shared, shared)).toThrow("separate from every encryption key");
    expect(() => createTestCredentialFingerprinter({ keyRef: "fp/v1", key: shared.key }, shared)).toThrow();
  });

  it("does not contain the credential, and rejects invalid input safely", async () => {
    const { fingerprinter } = cryptoSet();
    expect(JSON.stringify(await fingerprinter.fingerprint(SECRET))).not.toContain(SECRET);
    await expectCode(fingerprinter.fingerprint(""), "CREDENTIAL_INVALID");
  });
});

describe("authority separation", () => {
  it("gives a sealer no way to open, and a fingerprinter no way to open or seal", () => {
    const { sealer, opener, fingerprinter } = cryptoSet();
    expect(Object.keys(sealer)).toEqual(["seal"]);
    expect(Object.keys(opener)).toEqual(["open"]);
    expect(Object.keys(fingerprinter)).toEqual(["fingerprint"]);
    expect("open" in sealer).toBe(false);
    expect("open" in fingerprinter || "seal" in fingerprinter).toBe(false);
    expect(Object.isFrozen(sealer) && Object.isFrozen(opener) && Object.isFrozen(fingerprinter)).toBe(true);
  });
});

describe("redaction", () => {
  it("never writes the credential to logs or errors, on success or failure", async () => {
    const writes: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void writes.push(args.map(String).join(" ")));
    }
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => (writes.push(String(chunk)), true));
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => (writes.push(String(chunk)), true));

    const { sealer, opener, fingerprinter } = cryptoSet();
    const envelope = await sealer.seal(SECRET, context());
    await opener.open(envelope, context());
    await fingerprinter.fingerprint(SECRET);
    const failures = await Promise.allSettled([
      opener.open(envelope, context({ credentialVersion: 9 })),
      opener.open({ ...envelope, tag: flipFirstByte(envelope.tag) }, context()),
      sealer.seal(`${SECRET}\u0000`, context()),
      sealer.seal(SECRET, context({ accountId: SECRET })),
    ]);

    vi.restoreAllMocks();
    expect(writes.join("\n")).not.toContain(SECRET);
    for (const failure of failures) {
      expect(failure.status).toBe("rejected");
      const reason = (failure as PromiseRejectedResult).reason as Error;
      expect(`${reason.message} ${JSON.stringify(reason)} ${reason.stack ?? ""}`).not.toContain(SECRET);
      expect(reason.cause).toBeUndefined();
    }
  });

  it("uses fixed generic messages for every code", () => {
    const codes = ["CREDENTIAL_INVALID", "CONTEXT_INVALID", "ENVELOPE_UNSUPPORTED", "AUTHENTICATION_FAILED", "CRYPTO_UNAVAILABLE"] as const;
    const messages = codes.map((code) => new CredentialCryptoError(code).message);
    expect(new Set(messages).size).toBe(codes.length);
    for (const message of messages) {
      expect(message).not.toMatch(/key=|nonce=|tag=|base64|0x/i);
    }
  });
});
