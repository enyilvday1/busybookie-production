import { GoogleGenAI } from "@google/genai";

import type { SealedCredentialCapability } from "./credentialOpeningRun.js";
import {
  GOOGLE_API_BASE_URL,
  GOOGLE_API_VERSION,
  GOOGLE_CREATE_MAX_RETRIES,
  GOOGLE_CREATE_TIMEOUT_MS,
  GOOGLE_INTERACTION_FLAGS,
  GOOGLE_MODEL,
  GOOGLE_PROVIDER_ID,
  GOOGLE_RESPONSE_FORMAT,
  type GoogleGenerationRequest,
} from "./googleProviderContract.js";
import type { VerifiedReferenceImage } from "./inputMediaRetrieval.js";
import { isProviderExecutionId, type ProviderAcceptanceCallback, type ProviderSubmissionOutcome } from "./providerExecutionContract.js";
import { WorkerError } from "./workerError.js";

// The first real-provider create adapter
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 36,
// "First real-provider adapter: Google GenAI (revision R44B10A)"). The only
// worker module that imports the provider SDK. It owns the create phase
// only: one client, one interactions.create, the awaited acceptance
// callback. No polling, output, completion, retry or engine import, and no
// environment or filesystem access.
//
// It is prepared only after the pre-provider permit: preparation converts
// the verified bytes, re-opens the single granted credential through the
// sealed capability and constructs the one client. Every failure crosses
// this edge as a closed outcome; no provider body, message, header or cause
// does.

// Request-level Interactions error codes that prove a synchronous rejection
// before any Interaction.id (the published Gemini API error reference). They
// count only together with a known request-level HTTP status; any other code,
// a missing code or any other status (including 408, 409, 499, 500, 503, 504
// and every unknown status) is ambiguous.
export const GOOGLE_DEFINITIVE_ERROR_CODES = Object.freeze([
  "invalid_request",
  "failed_precondition",
  "parameter_unknown",
  "authentication",
  "payment_required",
  "permission_denied",
  "not_found",
  "model_not_found",
  "out_of_range",
  "rate_limit_exceeded",
  "quota_exceeded",
  "too_many_requests",
  "unimplemented",
] as const);

const DEFINITIVE_CODES: ReadonlySet<string> = new Set(GOOGLE_DEFINITIVE_ERROR_CODES);
// The request-level statuses those codes are returned with (501 carries
// unimplemented). Every other status is ambiguous.
const REQUEST_LEVEL_STATUSES: ReadonlySet<number> = new Set([400, 401, 402, 403, 404, 422, 429, 501]);

// A nominal success without an acceptable Interaction.id: dispatch may have
// succeeded, so it is ambiguous, and it is also a host fault.
export type GoogleSubmissionOutcome = ProviderSubmissionOutcome | Readonly<{ kind: "AMBIGUOUS_FAILURE"; hostFault: "MALFORMED_PROVIDER_SUCCESS" }>;

export type GoogleSubmissionOperation = Readonly<{
  execute: (onAccepted: ProviderAcceptanceCallback) => Promise<GoogleSubmissionOutcome>;
}>;

// Tests inject a counting subclass of the real SDK class; production code has
// no other client.
export type GoogleClientConstructor = typeof GoogleGenAI;

export type GoogleSubmissionDependencies = Readonly<{
  // Required and explicit: there is no default provider transport.
  transport: typeof fetch;
  clientConstructor?: GoogleClientConstructor;
}>;

export type GoogleSubmissionPreparation = Readonly<{
  executionAttemptId: string;
  provider: string;
  request: GoogleGenerationRequest;
  image: VerifiedReferenceImage;
  sealedCredential: SealedCredentialCapability;
}>;

type InteractionCreateParameters = Parameters<GoogleGenAI["interactions"]["create"]>[0];

const field = (value: unknown, name: string): unknown =>
  typeof value === "object" && value !== null && Object.hasOwn(value, name) ? (value as Readonly<Record<string, unknown>>)[name] : undefined;

// From typed fields only: the SDK error's HTTP status and the machine-readable
// Interactions error code. Never from message text.
export function classifyGoogleCreateFailure(error: unknown): "DEFINITIVE_FAILURE" | "AMBIGUOUS_FAILURE" {
  const status = field(error, "status");
  if (typeof status !== "number" || !REQUEST_LEVEL_STATUSES.has(status)) return "AMBIGUOUS_FAILURE";
  const code = field(field(field(error, "error"), "error"), "code");
  return typeof code === "string" && DEFINITIVE_CODES.has(code) ? "DEFINITIVE_FAILURE" : "AMBIGUOUS_FAILURE";
}

// The exact first-slice request: adapter-owned model, response format and
// flags; the prompt as authorized; the verified bytes in base64.
export function buildGoogleInteractionRequest(request: GoogleGenerationRequest, image: VerifiedReferenceImage) {
  return Object.freeze({
    model: GOOGLE_MODEL,
    input: [
      Object.freeze({ type: "text" as const, text: request.prompt }),
      Object.freeze({ type: "image" as const, data: image.bytes.toString("base64"), mime_type: image.contentType }),
    ],
    response_format: Object.freeze({ ...GOOGLE_RESPONSE_FORMAT }),
    ...GOOGLE_INTERACTION_FLAGS,
  });
}

// Post-permit preparation. Any throw here happens before dispatch.
export async function prepareGoogleSubmission(
  preparation: GoogleSubmissionPreparation,
  dependencies: GoogleSubmissionDependencies,
): Promise<GoogleSubmissionOperation> {
  const { executionAttemptId, provider } = preparation;
  if (provider !== GOOGLE_PROVIDER_ID) throw new WorkerError("LEASED_PROVIDER_INCOMPATIBLE");
  if (typeof dependencies.transport !== "function") throw new WorkerError("WORKER_CONFIGURATION_INVALID");
  const Client = dependencies.clientConstructor ?? GoogleGenAI;
  let body: ReturnType<typeof buildGoogleInteractionRequest> | null = buildGoogleInteractionRequest(preparation.request, preparation.image);

  // The one client, built from the re-opened granted credential, explicitly
  // for the Gemini Developer API so no environment variable can redirect it.
  let client: GoogleGenAI | null = await preparation.sealedCredential.openOnceFor(
    { executionAttemptId, provider },
    (apiKey) =>
      new Client({
        apiKey,
        vertexai: false,
        apiVersion: GOOGLE_API_VERSION,
        httpOptions: { baseUrl: GOOGLE_API_BASE_URL, fetch: dependencies.transport },
      }),
  );

  let dispatched = false;
  return Object.freeze({
    execute: async (onAccepted: ProviderAcceptanceCallback): Promise<GoogleSubmissionOutcome> => {
      // At most one dispatch per operation; there is no retry path.
      if (dispatched || client === null || body === null) throw new WorkerError("PROVIDER_CONTRACT_VIOLATION");
      dispatched = true;
      const current = client;
      const payload = body;
      let interaction: unknown;
      try {
        interaction = await current.interactions.create(payload as unknown as InteractionCreateParameters, {
          maxRetries: GOOGLE_CREATE_MAX_RETRIES,
          timeout: GOOGLE_CREATE_TIMEOUT_MS,
        });
      } catch (error) {
        return classifyGoogleCreateFailure(error) === "DEFINITIVE_FAILURE"
          ? Object.freeze({ kind: "DEFINITIVE_FAILURE" as const })
          : Object.freeze({ kind: "AMBIGUOUS_FAILURE" as const });
      } finally {
        // The client and the request bytes are dropped once create settles.
        client = null;
        body = null;
      }
      const id = field(interaction, "id");
      if (!isProviderExecutionId(id)) return Object.freeze({ kind: "AMBIGUOUS_FAILURE", hostFault: "MALFORMED_PROVIDER_SUCCESS" });
      // The raw Interaction.id, unchanged; the callback is its only authority.
      await onAccepted({ provider: GOOGLE_PROVIDER_ID, providerExecutionId: id });
      return Object.freeze({ kind: "ACCEPTED" });
    },
  });
}
