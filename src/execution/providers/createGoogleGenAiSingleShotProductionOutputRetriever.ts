import type {
  GoogleGenAiOutputRetriever,
} from "./materializeGoogleGenAiSingleShotOutput.js";

/**
 * RETIRED legacy Google GenAI production output retriever.
 *
 * The former SDK-backed binding performed its own non-streaming same-ID
 * retrieval of output_video with its own client and credential: a second
 * observation and an unbounded alternate output path that bypasses secure
 * replay and streaming Files materialization. It is now a fail-closed
 * migration stub: every call throws synchronously with a static message
 * before any key use, client construction, provider call or network access.
 * It never delegates to the secure factory and offers no fallback. The
 * export name and return type are kept so that any accidental use fails
 * immediately and unmistakably.
 */

const RETIRED_MESSAGE =
  "createGoogleGenAiSingleShotProductionOutputRetriever is retired: the legacy SDK output lookup conflicts with secure one-replay recovery and streaming materialization. Use createGoogleGenAiSingleShotSecureProductionRecovery with reconcileGoogleGenAiExecutionLifecycle.";

export function createGoogleGenAiSingleShotProductionOutputRetriever(
  apiKey:
    string,
): GoogleGenAiOutputRetriever {
  // The key is intentionally never read, validated or echoed.
  void apiKey;

  throw new Error(
    RETIRED_MESSAGE,
  );
}
