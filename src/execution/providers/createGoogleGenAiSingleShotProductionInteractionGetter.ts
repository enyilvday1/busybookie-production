import type {
  GoogleGenAiInteractionGetter,
} from "./recoverGoogleGenAiSingleShot.js";

/**
 * RETIRED legacy Google GenAI production interaction getter.
 *
 * The former SDK-backed binding performed its own non-streaming same-ID
 * lookup with its own client and credential. That is a second remote
 * observation per reconciliation and conflicts with the secure one-replay
 * recovery architecture, so it is a fail-closed migration stub: every call
 * throws synchronously with a static message before any key use, client
 * construction, provider call or network access. It never delegates to the
 * secure factory and offers no fallback. The export name and return type are
 * kept so that any accidental use fails immediately and unmistakably.
 */

const RETIRED_MESSAGE =
  "createGoogleGenAiSingleShotProductionInteractionGetter is retired: the legacy SDK same-ID lookup conflicts with secure one-replay recovery. Use createGoogleGenAiSingleShotSecureProductionRecovery with reconcileGoogleGenAiExecutionLifecycle.";

export function createGoogleGenAiSingleShotProductionInteractionGetter(
  apiKey:
    string,
): GoogleGenAiInteractionGetter {
  // The key is intentionally never read, validated or echoed.
  void apiKey;

  throw new Error(
    RETIRED_MESSAGE,
  );
}
