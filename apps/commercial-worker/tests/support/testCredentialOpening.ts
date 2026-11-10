// TEST FIXTURE ONLY. The worker's CredentialOpener in this slice is the
// existing commercial-api test crypto (AES-256-GCM with a generated test key),
// reused rather than reimplemented so there is exactly one envelope format.
// No production key, KMS or opener exists; worker source never imports this.
export {
  createTestCredentialOpener,
  createTestCredentialSealer,
  createTestCredentialFingerprinter,
  generateTestKey,
} from "../../../commercial-api/tests/support/testCredentialCrypto.js";
