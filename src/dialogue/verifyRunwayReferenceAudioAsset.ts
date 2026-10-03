import {
  createHash,
} from "node:crypto";

import {
  createReadStream,
} from "node:fs";

import {
  realpath as fsRealpath,
  stat,
} from "node:fs/promises";

import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  RunwayReferenceAudioAssetSchema,
  type RunwayReferenceAudioAsset,
} from "../schemas/character.schema.js";

import {
  probeDialogueAudio,
} from "./probeDialogueAudio.js";

export type VerifiedRunwayReferenceAudioAsset =
  Readonly<{
    assetId:
      string;

    mediaRootRelativePath:
      string;

    absolutePath:
      string;

    bytes:
      number;

    sha256:
      string;

    contentType:
      string;

    durationSeconds:
      number;

    codecName:
      string;

    sampleRateHz:
      number;

    channels:
      number;
  }>;

export type RunwayReferenceAudioRealpath =
  (
    path:
      string,
  ) => Promise<string>;

export type VerifyRunwayReferenceAudioAssetInput =
  Readonly<{
    mediaRoot:
      string;

    referenceAudio:
      RunwayReferenceAudioAsset;

    ffprobeExecutable:
      string;
  }>;

export type VerifyRunwayReferenceAudioAssetDependencies =
  Readonly<{
    probeAudio?:
      typeof probeDialogueAudio;

    realpath?:
      RunwayReferenceAudioRealpath;
  }>;

const REFERENCE_AUDIO_DURATION_TOLERANCE_SECONDS =
  0.05;

function isPathInsideRoot(
  rootPath:
    string,

  candidatePath:
    string,
): boolean {
  const relativePath =
    relative(
      rootPath,
      candidatePath,
    );

  return (
    relativePath !==
      ".." &&
    !relativePath.startsWith(
      `..${sep}`,
    ) &&
    !isAbsolute(
      relativePath,
    )
  );
}

function isPathStrictlyInsideRoot(
  rootPath:
    string,

  candidatePath:
    string,
): boolean {
  return (
    resolve(
      rootPath,
    ) !==
      resolve(
        candidatePath,
      ) &&
    isPathInsideRoot(
      rootPath,
      candidatePath,
    )
  );
}

async function resolvePhysicalPath(
  path:
    string,

  label:
    string,

  resolveRealpath:
    RunwayReferenceAudioRealpath,
): Promise<string> {
  try {
    return await resolveRealpath(
      path,
    );
  } catch (error) {
    throw new Error(
      `Runway reference-audio ${label} could not be resolved: ${path}`,
      {
        cause:
          error,
      },
    );
  }
}

async function inspectReferenceAudioFile(
  filePath:
    string,

  expectedBytes:
    number,
): Promise<
  Readonly<{
    bytes:
      number;

    sha256:
      string;
  }>
> {
  const metadata =
    await stat(
      filePath,
    );

  if (
    !metadata.isFile()
  ) {
    throw new Error(
      `Runway reference-audio path is not a regular file: ${filePath}`,
    );
  }

  if (
    metadata.size !==
      expectedBytes
  ) {
    throw new Error(
      `Runway reference-audio byte-count mismatch for ${filePath}: expected ${expectedBytes}, received ${metadata.size}.`,
    );
  }

  const hash =
    createHash(
      "sha256",
    );

  let bytes =
    0;

  const stream =
    createReadStream(
      filePath,
    );

  for await (
    const chunk
    of stream
  ) {
    const buffer =
      Buffer.isBuffer(
        chunk,
      )
        ? chunk
        : Buffer.from(
            chunk,
          );

    bytes +=
      buffer.length;

    if (
      bytes >
        expectedBytes
    ) {
      throw new Error(
        `Runway reference-audio file exceeded its immutable ${expectedBytes}-byte identity while hashing: ${filePath}`,
      );
    }

    hash.update(
      buffer,
    );
  }

  if (
    bytes !==
      expectedBytes
  ) {
    throw new Error(
      `Runway reference-audio byte-count mismatch while hashing ${filePath}: expected ${expectedBytes}, received ${bytes}.`,
    );
  }

  const afterHashMetadata =
    await stat(
      filePath,
    );

  if (
    !afterHashMetadata.isFile() ||
    afterHashMetadata.size !==
      expectedBytes
  ) {
    throw new Error(
      `Runway reference-audio file changed while it was being inspected: ${filePath}`,
    );
  }

  return Object.freeze({
    bytes,

    sha256:
      hash.digest(
        "hex",
      ),
  });
}

export async function verifyRunwayReferenceAudioAsset(
  input:
    VerifyRunwayReferenceAudioAssetInput,

  dependencies:
    VerifyRunwayReferenceAudioAssetDependencies =
      {},
): Promise<VerifiedRunwayReferenceAudioAsset> {
  const normalizedMediaRoot =
    input.mediaRoot.trim();

  if (
    !normalizedMediaRoot
  ) {
    throw new Error(
      "Busybookie media root is required for Runway reference-audio verification.",
    );
  }

  if (
    !isAbsolute(
      normalizedMediaRoot,
    )
  ) {
    throw new Error(
      "Busybookie media root must be absolute for Runway reference-audio verification.",
    );
  }

  const ffprobeExecutable =
    input.ffprobeExecutable.trim();

  if (
    !ffprobeExecutable
  ) {
    throw new Error(
      "Runway reference-audio verification requires an ffprobe executable.",
    );
  }

  const referenceAudio =
    RunwayReferenceAudioAssetSchema
      .parse(
        input.referenceAudio,
      );

  const absoluteMediaRoot =
    resolve(
      normalizedMediaRoot,
    );

  const referenceRoot =
    resolve(
      absoluteMediaRoot,
      "references",
    );

  const trustedVoiceRoot =
    resolve(
      referenceRoot,
      "voices",
    );

  const absolutePath =
    resolve(
      absoluteMediaRoot,
      ...referenceAudio
        .mediaRootRelativePath
        .split(
          "/",
        ),
    );

  if (
    !isPathInsideRoot(
      trustedVoiceRoot,
      absolutePath,
    )
  ) {
    throw new Error(
      `Runway reference-audio path must be inside ${trustedVoiceRoot}.`,
    );
  }

  const resolveRealpath =
    dependencies.realpath ??
      fsRealpath;

  const [
    physicalMediaRoot,
    physicalReferenceRoot,
    physicalVoiceRoot,
    physicalReferencePath,
  ] =
    await Promise.all([
      resolvePhysicalPath(
        absoluteMediaRoot,
        "media root",
        resolveRealpath,
      ),

      resolvePhysicalPath(
        referenceRoot,
        "references root",
        resolveRealpath,
      ),

      resolvePhysicalPath(
        trustedVoiceRoot,
        "references/voices root",
        resolveRealpath,
      ),

      resolvePhysicalPath(
        absolutePath,
        "asset path",
        resolveRealpath,
      ),
    ]);

  if (
    !isPathStrictlyInsideRoot(
      physicalMediaRoot,
      physicalReferenceRoot,
    )
  ) {
    throw new Error(
      "Runway reference-audio physical references root is outside the Busybookie media root.",
    );
  }

  if (
    !isPathStrictlyInsideRoot(
      physicalReferenceRoot,
      physicalVoiceRoot,
    )
  ) {
    throw new Error(
      "Runway reference-audio physical references/voices root is outside the trusted references root.",
    );
  }

  if (
    !isPathStrictlyInsideRoot(
      physicalVoiceRoot,
      physicalReferencePath,
    )
  ) {
    throw new Error(
      "Runway reference-audio physical asset path is outside the trusted references/voices root.",
    );
  }

  const inspected =
    await inspectReferenceAudioFile(
      physicalReferencePath,
      referenceAudio.bytes,
    );

  if (
    inspected.sha256 !==
      referenceAudio.sha256
  ) {
    throw new Error(
      `Runway reference-audio SHA-256 mismatch for ${physicalReferencePath}.`,
    );
  }

  const probeAudio =
    dependencies.probeAudio ??
      probeDialogueAudio;

  const probed =
    await probeAudio({
      ffprobeExecutable,
      sourceAudioPath:
        physicalReferencePath,
    });

  if (
    probed.audio.codecName !==
      referenceAudio.codecName
  ) {
    throw new Error(
      `Runway reference-audio codec mismatch for ${physicalReferencePath}: expected ${referenceAudio.codecName}, received ${probed.audio.codecName}.`,
    );
  }

  if (
    probed.audio.sampleRateHz !==
      referenceAudio.sampleRateHz
  ) {
    throw new Error(
      `Runway reference-audio sample rate mismatch for ${physicalReferencePath}: expected ${referenceAudio.sampleRateHz}, received ${probed.audio.sampleRateHz}.`,
    );
  }

  if (
    probed.audio.channels !==
      referenceAudio.channels
  ) {
    throw new Error(
      `Runway reference-audio channel count mismatch for ${physicalReferencePath}: expected ${referenceAudio.channels}, received ${probed.audio.channels}.`,
    );
  }

  const durationDifference =
    Math.abs(
      probed.durationSeconds -
        referenceAudio.durationSeconds,
    );

  if (
    durationDifference >
      REFERENCE_AUDIO_DURATION_TOLERANCE_SECONDS
  ) {
    throw new Error(
      `Runway reference-audio duration mismatch for ${physicalReferencePath}: expected ${referenceAudio.durationSeconds}s within ${REFERENCE_AUDIO_DURATION_TOLERANCE_SECONDS}s tolerance, received ${probed.durationSeconds}s.`,
    );
  }

  return Object.freeze({
    assetId:
      referenceAudio.assetId,

    mediaRootRelativePath:
      referenceAudio.mediaRootRelativePath,

    absolutePath:
      physicalReferencePath,

    bytes:
      inspected.bytes,

    sha256:
      inspected.sha256,

    contentType:
      referenceAudio.contentType,

    durationSeconds:
      referenceAudio.durationSeconds,

    codecName:
      referenceAudio.codecName,

    sampleRateHz:
      referenceAudio.sampleRateHz,

    channels:
      referenceAudio.channels,
  });
}
