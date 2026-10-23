/**
 * Pure local contract for Google GenAI Interaction identity and status.
 *
 * Status literals are pinned from the installed @google/genai 2.24.0
 * declarations (Interaction.status: InteractionStatus_2). The SDK type is
 * open-ended ("... | (string & {})") and its namespace is not exported from
 * the package root, so the literals are declared locally and every value
 * outside this list is rejected at runtime. Re-inspect on any SDK upgrade.
 */
export const GOOGLE_GENAI_INTERACTION_STATUSES =
  Object.freeze([
    "queued",
    "in_progress",
    "completed",
    "failed",
    "cancelled",
    "incomplete",
    "budget_exceeded",
    "requires_action",
  ] as const);

export type GoogleGenAiInteractionStatus =
  typeof GOOGLE_GENAI_INTERACTION_STATUSES[number];

export const GOOGLE_GENAI_INTERACTION_LIFECYCLE_CLASSES =
  Object.freeze([
    "PENDING",
    "SUCCESS",
    "TERMINAL_FAILURE",
    "ACTION_REQUIRED_UNSUPPORTED",
  ] as const);

export type GoogleGenAiInteractionLifecycleClass =
  typeof GOOGLE_GENAI_INTERACTION_LIFECYCLE_CLASSES[number];

const STATUS_LIFECYCLE_CLASS:
  Readonly<
    Record<
      GoogleGenAiInteractionStatus,
      GoogleGenAiInteractionLifecycleClass
    >
  > =
    Object.freeze({
      queued:
        "PENDING",

      in_progress:
        "PENDING",

      completed:
        "SUCCESS",

      failed:
        "TERMINAL_FAILURE",

      cancelled:
        "TERMINAL_FAILURE",

      incomplete:
        "TERMINAL_FAILURE",

      budget_exceeded:
        "TERMINAL_FAILURE",

      // The interaction is waiting on client-supplied tool/function
      // continuation, which BusyBookie cannot provide. Operator/design
      // review is required; this is not success, pending, or failure.
      requires_action:
        "ACTION_REQUIRED_UNSUPPORTED",
    });

function describeValue(
  value:
    unknown,
): string {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  return typeof value;
}

/**
 * Maps a Google Interaction's `id` to BusyBookie's canonical
 * providerExecutionId. Returns only the normalized identifier.
 */
export function normalizeGoogleGenAiProviderExecutionId(
  interaction:
    unknown,
): string {
  if (
    interaction === null ||
    typeof interaction !== "object" ||
    Array.isArray(interaction)
  ) {
    throw new Error(
      `Google GenAI interaction must be an object; received ${describeValue(interaction)}.`,
    );
  }

  const id =
    (
      interaction as {
        readonly id?: unknown;
      }
    ).id;

  if (typeof id !== "string") {
    throw new Error(
      `Google GenAI interaction id must be a string; received ${describeValue(id)}.`,
    );
  }

  const providerExecutionId =
    id.trim();

  if (providerExecutionId.length === 0) {
    throw new Error(
      "Google GenAI interaction id must not be empty.",
    );
  }

  return providerExecutionId;
}

/**
 * Assigns BusyBookie's lifecycle class to an observed Google Interaction
 * status. Fails closed on any value outside the pinned SDK literals.
 */
export function classifyGoogleGenAiInteractionStatus(
  status:
    unknown,
): GoogleGenAiInteractionLifecycleClass {
  if (typeof status !== "string") {
    throw new Error(
      `Google GenAI interaction status must be a string; received ${describeValue(status)}.`,
    );
  }

  if (
    !Object.hasOwn(
      STATUS_LIFECYCLE_CLASS,
      status,
    )
  ) {
    throw new Error(
      `Google GenAI interaction status is not recognized: ${JSON.stringify(status)}.`,
    );
  }

  return STATUS_LIFECYCLE_CLASS[
    status as GoogleGenAiInteractionStatus
  ];
}
