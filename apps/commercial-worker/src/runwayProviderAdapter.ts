import RunwayML, { APIError } from "@runwayml/sdk";

import type { SealedCredentialCapability } from "./credentialOpeningRun.js";
import { detectReferenceImageType, type VerifiedReferenceImage } from "./inputMediaRetrieval.js";
import { isProviderExecutionId, type ProviderAcceptanceCallback, type ProviderSubmissionOutcome } from "./providerExecutionContract.js";
import {
  RUNWAY_API_BASE_URL,
  RUNWAY_API_VERSION,
  RUNWAY_CREATE_MAX_RETRIES,
  RUNWAY_CREATE_TIMEOUT_MS,
  RUNWAY_DATA_URI_MAX_CHARS,
  RUNWAY_MODEL,
  RUNWAY_OUTPUT_FORMAT,
  RUNWAY_PROVIDER_ID,
  RUNWAY_RATIO,
  type RunwayGenerationRequest,
} from "./runwayProviderContract.js";
import { WorkerError } from "./workerError.js";

// The second real-provider create adapter
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 36,
// "Second real-provider adapter: Runway Gen-4.5 (revision R44B10B)"). The only
// worker module that imports the Runway SDK. It owns the create phase only:
// one client, one imageToVideo.create, the awaited acceptance callback. No
// task retrieval, waiting, upload, output, completion, retry or engine
// import, and no environment or filesystem access.
//
// It is prepared only after the pre-provider permit: preparation re-opens the
// single granted credential through the sealed capability, then builds the
// inline data URI from the verified bytes, then constructs the one client.
// Every failure crosses this edge as a closed outcome; no provider body,
// message, header or cause does.

// Typed API response statuses that prove a synchronous rejection before any
// task ID. Every other status (including 408, 409 and every 5xx) and every
// transport failure is ambiguous.
export const RUNWAY_DEFINITIVE_STATUSES = Object.freeze([400, 401, 403, 404, 422, 429] as const);
const DEFINITIVE_STATUSES: ReadonlySet<number> = new Set(RUNWAY_DEFINITIVE_STATUSES);

// A nominal success without an acceptable task ID: dispatch may have
// succeeded, so it is ambiguous, and it is also a host fault.
export type RunwaySubmissionOutcome = ProviderSubmissionOutcome | Readonly<{ kind: "AMBIGUOUS_FAILURE"; hostFault: "MALFORMED_PROVIDER_SUCCESS" }>;

export type RunwaySubmissionOperation = Readonly<{
  execute: (onAccepted: ProviderAcceptanceCallback) => Promise<RunwaySubmissionOutcome>;
}>;

// Tests inject a counting subclass of the real SDK class; production code has
// no other client.
export type RunwayClientConstructor = typeof RunwayML;

export type RunwaySubmissionDependencies = Readonly<{
  // Required and explicit: there is no default provider transport.
  transport: typeof fetch;
  clientConstructor?: RunwayClientConstructor;
}>;

export type RunwaySubmissionPreparation = Readonly<{
  executionAttemptId: string;
  provider: string;
  request: RunwayGenerationRequest;
  image: VerifiedReferenceImage;
  sealedCredential: SealedCredentialCapability;
}>;

const field = (value: unknown, name: string): unknown =>
  typeof value === "object" && value !== null && Object.hasOwn(value, name) ? (value as Readonly<Record<string, unknown>>)[name] : undefined;

// From typed fields only: an SDK API error and its HTTP status. Never from
// message text, body, headers or cause.
export function classifyRunwayCreateFailure(error: unknown): "DEFINITIVE_FAILURE" | "AMBIGUOUS_FAILURE" {
  if (!(error instanceof APIError)) return "AMBIGUOUS_FAILURE";
  const status = field(error, "status");
  return typeof status === "number" && DEFINITIVE_STATUSES.has(status) ? "DEFINITIVE_FAILURE" : "AMBIGUOUS_FAILURE";
}

// The exact inline image: the media type is the one detected from the
// verified bytes (and must equal the verified type), and the final string is
// held to the provider's data-URI limit. A failure is a local invariant fault
// before any client or dispatch.
export function buildRunwayDataUri(image: VerifiedReferenceImage): string {
  const detected = detectReferenceImageType(image.bytes);
  if (detected === null || detected !== image.contentType) throw new WorkerError("PROVIDER_CONTRACT_VIOLATION");
  const uri = `data:${detected};base64,${Buffer.from(image.bytes).toString("base64")}`;
  if (uri.length > RUNWAY_DATA_URI_MAX_CHARS) throw new WorkerError("PROVIDER_CONTRACT_VIOLATION");
  return uri;
}

// The exact create body: adapter-owned model, ratio and output format; the
// prompt and duration as authorised; the verified inline image.
export function buildRunwayCreateRequest(request: RunwayGenerationRequest, promptImage: string) {
  return Object.freeze({
    model: RUNWAY_MODEL,
    promptImage,
    promptText: request.prompt,
    ratio: RUNWAY_RATIO,
    duration: request.durationSeconds,
    outputFormat: RUNWAY_OUTPUT_FORMAT,
  });
}

// Post-permit preparation. Any throw here happens before dispatch.
export async function prepareRunwaySubmission(
  preparation: RunwaySubmissionPreparation,
  dependencies: RunwaySubmissionDependencies,
): Promise<RunwaySubmissionOperation> {
  const { executionAttemptId, provider } = preparation;
  if (provider !== RUNWAY_PROVIDER_ID) throw new WorkerError("LEASED_PROVIDER_INCOMPATIBLE");
  if (typeof dependencies.transport !== "function") throw new WorkerError("WORKER_CONFIGURATION_INVALID");
  const Client = dependencies.clientConstructor ?? RunwayML;

  // The locked order: re-open the same sealed grant, then build the inline
  // data URI and body, then the one client, built with every authority
  // explicit so no environment variable can supply or redirect it. The key
  // stays inside this callback.
  let { client, body }: { client: RunwayML | null; body: ReturnType<typeof buildRunwayCreateRequest> | null } = await preparation.sealedCredential.openOnceFor(
    { executionAttemptId, provider },
    (apiKey) => {
      const request = buildRunwayCreateRequest(preparation.request, buildRunwayDataUri(preparation.image));
      const runway = new Client({
        apiKey,
        baseURL: RUNWAY_API_BASE_URL,
        runwayVersion: RUNWAY_API_VERSION,
        maxRetries: RUNWAY_CREATE_MAX_RETRIES,
        timeout: RUNWAY_CREATE_TIMEOUT_MS,
        fetch: dependencies.transport,
        logLevel: "off",
      });
      return { client: runway, body: request };
    },
  );

  let dispatched = false;
  return Object.freeze({
    execute: async (onAccepted: ProviderAcceptanceCallback): Promise<RunwaySubmissionOutcome> => {
      // At most one dispatch per operation; there is no retry path.
      if (dispatched || client === null || body === null) throw new WorkerError("PROVIDER_CONTRACT_VIOLATION");
      dispatched = true;
      const current = client;
      const payload = body;
      let task: unknown;
      try {
        task = await current.imageToVideo.create(payload, {
          maxRetries: RUNWAY_CREATE_MAX_RETRIES,
          timeout: RUNWAY_CREATE_TIMEOUT_MS,
        });
      } catch (error) {
        return classifyRunwayCreateFailure(error) === "DEFINITIVE_FAILURE"
          ? Object.freeze({ kind: "DEFINITIVE_FAILURE" as const })
          : Object.freeze({ kind: "AMBIGUOUS_FAILURE" as const });
      } finally {
        // The client and the request bytes are dropped once create settles.
        client = null;
        body = null;
      }
      const id = field(task, "id");
      if (!isProviderExecutionId(id)) return Object.freeze({ kind: "AMBIGUOUS_FAILURE", hostFault: "MALFORMED_PROVIDER_SUCCESS" });
      // The raw task.id, unchanged; the callback is its only authority.
      await onAccepted({ provider: RUNWAY_PROVIDER_ID, providerExecutionId: id });
      return Object.freeze({ kind: "ACCEPTED" });
    },
  });
}
