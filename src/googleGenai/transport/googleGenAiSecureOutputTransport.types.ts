import type { GoogleGenAiInteractionStatus } from "../googleGenAiInteractionContract.js";

export type GoogleGenAiInteractionReplayResult = Readonly<{
  id: string;
  status: GoogleGenAiInteractionStatus;
  outputVideo: Readonly<{ type: "video"; mime_type: "video/mp4"; uri: string }> | null;
}>;

export type GoogleGenAiRecoveryContext = Readonly<{
  signal: AbortSignal;
  remainingMs: () => number;
}>;

export type GoogleGenAiFetch = (input: string, init: RequestInit) => Promise<Response>;
export type GoogleGenAiValidatedFileResource = Readonly<{
  fileId: string;
  name: string;
  downloadUri: string;
}>;
export type GoogleGenAiVerifiedFileMetadata = Readonly<{
  resource: GoogleGenAiValidatedFileResource;
  byteCount: number;
  sha256: string;
  mimeType: "video/mp4";
  expirationTime: string;
  expirationTimeMs: number;
}>;
export type GoogleGenAiOutputChunkSink = Readonly<{
  writeChunk: (chunk: Uint8Array) => Promise<void>;
}>;
export type GoogleGenAiDownloadedFile = Readonly<{
  byteCount: number;
  sha256: string;
  mimeType: "video/mp4";
}>;
export type GoogleGenAiReplayInteraction = (
  providerExecutionId: string, context: GoogleGenAiRecoveryContext,
) => Promise<GoogleGenAiInteractionReplayResult>;
export type GoogleGenAiPrepareOutputUri = (
  request: Readonly<{ uri: string; maxOutputBytes: number }>, context: GoogleGenAiRecoveryContext,
) => Promise<GoogleGenAiVerifiedFileMetadata>;
export type GoogleGenAiOutputUriDownloader = (
  metadata: GoogleGenAiVerifiedFileMetadata, sink: GoogleGenAiOutputChunkSink, context: GoogleGenAiRecoveryContext,
) => Promise<GoogleGenAiDownloadedFile>;

/** Structural contracts only. Operational values enter through dependency construction. */
export type GoogleGenAiSecureOutputTransportPolicy = Readonly<{
  limits: Readonly<{
    maxOutputBytes: number;
    filesMetadataMaxResponseBytes: number;
    sseMaxEventBytes: number;
    sseMaxResponseBytesPerAttempt: number;
    sseMaxEventsPerAttempt: number;
  }>;
  timeouts: Readonly<{
    streamConnectHeadersTimeoutMs: number;
    streamIdleTimeoutMs: number;
    streamAttemptTimeoutMs: number;
    filesMetadataTimeoutMs: number;
    filesDownloadTimeoutMs: number;
    reconciliationAttemptTimeoutMs: number;
  }>;
  recovery: Readonly<{
    automatedRemoteRecoveryHorizonMs: number;
    filesMinRemainingLifetimeMs: number;
    maxStreamRecoveryAttemptsPerReconciliation: number;
    maxFilesDownloadAttemptsPerReconciliation: number;
    streamRecoveryFirstRetryDelayMs: number;
    streamRecoverySecondRetryDelayMs: number;
    filesDownloadRetryDelayMs: number;
  }>;
}>;
