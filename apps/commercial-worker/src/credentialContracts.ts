// The worker's single import point for the provider-credential cryptography
// contract: the CredentialOpener interface, the canonical opening context and
// the strict sealed-envelope parser. They come from the shared, pure
// commercial-worker-protocol package, which commercial-api also uses, so
// there is exactly one envelope and context format and the worker imports no
// commercial-api module at all.
export {
  parseSealedEnvelope,
  validateSealingContext,
  type CredentialOpener,
  type CredentialSealingContext,
  type SealedCredentialEnvelope,
} from "commercial-worker-protocol";
