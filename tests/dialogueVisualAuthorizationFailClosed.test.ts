import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  dirname,
  join,
} from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createDialogueVisualAuthorizationPath,
} from "../src/execution/dialogueVisualAuthorizationPath.js";

import type {
  DialogueVisualAuthorization,
} from "../src/execution/dialogueVisualAuthorization.schema.js";

import {
  executeSingleShot,
} from "../src/execution/executeSingleShot.js";

import {
  readDialogueVisualAuthorization,
} from "../src/execution/readDialogueVisualAuthorization.js";

import type {
  SingleShotExecutionDependencies,
} from "../src/execution/singleShotExecution.types.js";

import {
  evaluateShotExecutionReadiness,
} from "../src/planning/evaluateShotExecutionReadiness.js";

import type {
  EpisodeManifest,
  Shot,
} from "../src/schemas/episodeManifest.schema.js";

import {
  loadCharacterBible,
} from "../src/validation/loadCharacterBible.js";

import {
  loadEpisodeManifest,
} from "../src/validation/loadEpisodeManifest.js";

import {
  loadProductionRules,
} from "../src/validation/loadProductionRules.js";

import {
  loadProviderRoutingPolicy,
} from "../src/validation/loadProviderRoutingPolicy.js";

const AUTHORIZATION_ID =
  "123e4567-e89b-42d3-a456-426614174000";

const AUTHORIZED_AT =
  "2026-10-08T10:00:00.000Z";

const temporaryDirectories:
  string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(
        (directory) =>
          rm(
            directory,
            {
              recursive: true,
              force: true,
            },
          ),
      ),
  );
});

async function makeTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-dialogue-visual-negative-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

async function loadContext() {
  const [
    bible,
    rules,
    policy,
  ] = await Promise.all([
    loadCharacterBible(),
    loadProductionRules(),
    loadProviderRoutingPolicy(),
  ]);

  return {
    bible,
    rules,
    policy,
  };
}

function requireShot(
  episode:
    EpisodeManifest,
  shotId:
    string,
): Shot {
  for (
    const scene
    of episode.scenes
  ) {
    const shot =
      scene.shots.find(
        (candidate) =>
          candidate.id ===
          shotId,
      );

    if (shot) {
      return shot;
    }
  }

  throw new Error(
    `Expected shot ${shotId}.`,
  );
}

function requireOllie(
  bible:
    Awaited<
      ReturnType<
        typeof loadCharacterBible
      >
    >,
) {
  const ollie =
    bible.characters.find(
      (character) =>
        character.id ===
        "OLLIE",
    );

  if (!ollie) {
    throw new Error(
      "Expected OLLIE in character bible.",
    );
  }

  return ollie;
}

function lockOllieVoice(
  bible:
    Awaited<
      ReturnType<
        typeof loadCharacterBible
      >
    >,
): void {
  const ollie =
    requireOllie(
      bible,
    );

  if (
    ollie.voice.selectionStatus !==
    "LOCKED"
  ) {
    throw new Error(
      "Expected OLLIE voice to already be LOCKED for the dialogue-visual authorization fixture.",
    );
  }
}

function authorizationRecord(
  overrides:
    Partial<
      DialogueVisualAuthorization
    > = {},
): DialogueVisualAuthorization {
  return {
    schemaVersion:
      "1.0",

    authorizationId:
      AUTHORIZATION_ID,

    authorizedAt:
      AUTHORIZED_AT,

    status:
      "AUTHORIZED",

    episodeId:
      "EP02",

    shotId:
      "S02",

    purpose:
      "DIALOGUE_VISUAL_GENERATION",

    provider:
      "VEO",

    nativeAudioDisposition:
      "DISCARD_AFTER_VISUAL_GENERATION",

    dialogueAuthority:
      "EXTERNAL_VERIFIED_DIALOGUE",

    authorizationSource:
      "HUMAN_OPERATOR",

    ...overrides,
  } as
    DialogueVisualAuthorization;
}

async function makeReadyDialogueFixture() {
  const [
    sourceEpisode,
    context,
    mediaRoot,
  ] = await Promise.all([
    loadEpisodeManifest(
      "EP02",
    ),
    loadContext(),
    makeTempDirectory(),
  ]);

  const episode =
    structuredClone(
      sourceEpisode,
    );

  const bible =
    structuredClone(
      context.bible,
    );

  lockOllieVoice(
    bible,
  );

  episode.status =
    "READY_FOR_GENERATION";

  episode.approvals.script =
    "APPROVED";

  episode.approvals.storyboard =
    "APPROVED";

  episode.approvals.references =
    "APPROVED";

  const shot =
    requireShot(
      episode,
      "S02",
    );

  shot.references.required =
    true;

  shot.references.assetIds = [
    "OLLIE_CHARACTER_MASTER_REFERENCE_V1",
  ];

  shot.references.approvalStatus =
    "APPROVED";

  shot.generation.provider =
    "VEO";

  shot.generation.nativeAudio =
    true;

  shot.generation.status =
    "APPROVED_FOR_GENERATION";

  return {
    episode,
    bible,
    rules:
      context.rules,
    policy:
      context.policy,
    shot,
    mediaRoot,
  };
}

function makeExecutionHarness(
  reader:
    NonNullable<
      SingleShotExecutionDependencies[
        "readDialogueVisualAuthorization"
      ]
    >,
) {
  const createReservation =
    vi.fn(
      async () => {
        throw new Error(
          "Reservation must not run.",
        );
      },
    );

  const createSubmission =
    vi.fn(
      async () => {
        throw new Error(
          "Submission must not run.",
        );
      },
    );

  const createCompletion =
    vi.fn(
      async () => {
        throw new Error(
          "Completion must not run.",
        );
      },
    );

  const executeRunway =
    vi.fn(
      async () => {
        throw new Error(
          "Runway must not run.",
        );
      },
    );

  const executeVeo =
    vi.fn(
      async () => {
        throw new Error(
          "Veo must not run.",
        );
      },
    );

  const dependencies = {
    readDialogueVisualAuthorization:
      reader,

    createReservation,
    createSubmission,
    createCompletion,
    executeRunway,
    executeVeo,
  } satisfies
    SingleShotExecutionDependencies;

  return {
    dependencies,
    createReservation,
    executeRunway,
    executeVeo,
  };
}

function expectNoPaidSideEffects(
  harness:
    ReturnType<
      typeof makeExecutionHarness
    >,
): void {
  expect(
    harness.createReservation,
  ).not.toHaveBeenCalled();

  expect(
    harness.executeRunway,
  ).not.toHaveBeenCalled();

  expect(
    harness.executeVeo,
  ).not.toHaveBeenCalled();
}

describe(
  "Busybookie dialogue-visual authorization fail-closed certification",
  () => {
    it(
      "rejects a schema-valid authorization returned for the wrong episode identity",
      async () => {
        const fixture =
          await makeReadyDialogueFixture();

        const reader =
          vi.fn(
            async () =>
              authorizationRecord({
                episodeId:
                  "EP99",
              }),
          );

        const harness =
          makeExecutionHarness(
            reader,
          );

        await expect(
          executeSingleShot(
            {
              episode:
                fixture.episode,
              shotId:
                "S02",
              bible:
                fixture.bible,
              rules:
                fixture.rules,
              policy:
                fixture.policy,
              mediaRoot:
                fixture.mediaRoot,
              sourceImagePath:
                join(
                  fixture.mediaRoot,
                  "references",
                  "ollie.png",
                ),
              confirmPaidGeneration:
                true,
            },
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /authorization episode EP99 does not match execution episode EP02/i,
        );

        expect(
          reader,
        ).toHaveBeenCalledWith(
          fixture.mediaRoot,
          "EP02",
          "S02",
        );

        expectNoPaidSideEffects(
          harness,
        );
      },
    );

    it(
      "rejects a schema-valid authorization returned for the wrong shot identity",
      async () => {
        const fixture =
          await makeReadyDialogueFixture();

        const reader =
          vi.fn(
            async () =>
              authorizationRecord({
                shotId:
                  "S99",
              }),
          );

        const harness =
          makeExecutionHarness(
            reader,
          );

        await expect(
          executeSingleShot(
            {
              episode:
                fixture.episode,
              shotId:
                "S02",
              bible:
                fixture.bible,
              rules:
                fixture.rules,
              policy:
                fixture.policy,
              mediaRoot:
                fixture.mediaRoot,
              sourceImagePath:
                join(
                  fixture.mediaRoot,
                  "references",
                  "ollie.png",
                ),
              confirmPaidGeneration:
                true,
            },
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /authorization shot S99 does not match execution shot S02/i,
        );

        expectNoPaidSideEffects(
          harness,
        );
      },
    );

    it(
      "rejects an authorization provider mismatch after the authorization reader is entered",
      async () => {
        const fixture =
          await makeReadyDialogueFixture();

        const reader =
          vi.fn(
            async () =>
              authorizationRecord({
                provider:
                  "RUNWAY",
              }),
          );

        const harness =
          makeExecutionHarness(
            reader,
          );

        await expect(
          executeSingleShot(
            {
              episode:
                fixture.episode,
              shotId:
                "S02",
              bible:
                fixture.bible,
              rules:
                fixture.rules,
              policy:
                fixture.policy,
              mediaRoot:
                fixture.mediaRoot,
              sourceImagePath:
                join(
                  fixture.mediaRoot,
                  "references",
                  "ollie.png",
                ),
              confirmPaidGeneration:
                true,
            },
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /authorization provider RUNWAY does not match manifest generation provider VEO/i,
        );

        expect(
          reader,
        ).toHaveBeenCalledTimes(
          1,
        );

        expectNoPaidSideEffects(
          harness,
        );
      },
    );

    it(
      "schema-parses injected authorization evidence before trusting its identity",
      async () => {
        const fixture =
          await makeReadyDialogueFixture();

        const reader =
          vi.fn(
            async () =>
              ({
                schemaVersion:
                  "1.0",
              } as never),
          );

        const harness =
          makeExecutionHarness(
            reader,
          );

        await expect(
          executeSingleShot(
            {
              episode:
                fixture.episode,
              shotId:
                "S02",
              bible:
                fixture.bible,
              rules:
                fixture.rules,
              policy:
                fixture.policy,
              mediaRoot:
                fixture.mediaRoot,
              sourceImagePath:
                join(
                  fixture.mediaRoot,
                  "references",
                  "ollie.png",
                ),
              confirmPaidGeneration:
                true,
            },
            harness.dependencies,
          ),
        ).rejects.toThrow();

        expect(
          reader,
        ).toHaveBeenCalledTimes(
          1,
        );

        expectNoPaidSideEffects(
          harness,
        );
      },
    );

    it(
      "fails closed when durable authorization JSON is syntactically valid but schema-invalid",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const authorizationPath =
          createDialogueVisualAuthorizationPath(
            mediaRoot,
            "EP02",
            "S02",
          );

        await mkdir(
          dirname(
            authorizationPath,
          ),
          {
            recursive:
              true,
          },
        );

        await writeFile(
          authorizationPath,
          JSON.stringify({
            schemaVersion:
              "1.0",

            authorizationId:
              "not-a-uuid",

            episodeId:
              "EP02",

            shotId:
              "S02",
          }),
          "utf8",
        );

        await expect(
          readDialogueVisualAuthorization(
            mediaRoot,
            "EP02",
            "S02",
          ),
        ).rejects.toThrow(
          /dialogue visual authorization is invalid/i,
        );
      },
    );

    it(
      "does not let durable manual-review resolution override routing BLOCKED",
      async () => {
        const [
          episode,
          sourceContext,
        ] = await Promise.all([
          loadEpisodeManifest(
            "EP02",
          ),
          loadContext(),
        ]);

        const bible =
          structuredClone(
            sourceContext.bible,
          );

        const ollie =
          requireOllie(
            bible,
          );

        const pendingProvider =
          ollie.voice.provider;

        const pendingDeliveryTraits = [
          ...ollie.voice
            .deliveryTraits,
        ];

        ollie.voice = {
          selectionStatus:
            "PENDING",

          provider:
            pendingProvider,

          voiceName:
            null,

          deliveryTraits:
            pendingDeliveryTraits,
        };

        const shot =
          requireShot(
            episode,
            "S02",
          );

        const result =
          evaluateShotExecutionReadiness(
            episode,
            shot,
            bible,
            sourceContext.rules,
            sourceContext.policy,
            {
              provider:
                "VEO",

              source:
                "DURABLE_DIALOGUE_VISUAL_AUTHORIZATION",
            },
          );

        expect(
          result.routing.disposition,
        ).toBe(
          "BLOCKED",
        );

        expect(
          result.disposition,
        ).toBe(
          "BLOCKED",
        );

        expect(
          result.executionProvider,
        ).toBeNull();

        expect(
          result.blockers.join(
            " ",
          ),
        ).toMatch(
          /locked|voice/i,
        );
      },
    );

    it(
      "does not let durable manual-review resolution override routing CONFLICT",
      async () => {
        const [
          sourceEpisode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest(
            "EP91",
          ),
          loadContext(),
        ]);

        const episode =
          structuredClone(
            sourceEpisode,
          );

        const shot =
          requireShot(
            episode,
            "S01",
          );

        shot.generation.provider =
          "RUNWAY";

        const result =
          evaluateShotExecutionReadiness(
            episode,
            shot,
            context.bible,
            context.rules,
            context.policy,
            {
              provider:
                "VEO",

              source:
                "DURABLE_DIALOGUE_VISUAL_AUTHORIZATION",
            },
          );

        expect(
          result.routing.disposition,
        ).toBe(
          "CONFLICT",
        );

        expect(
          result.disposition,
        ).toBe(
          "CONFLICT",
        );

        expect(
          result.executionProvider,
        ).toBeNull();
      },
    );

    it(
      "rejects durable manual-review resolution on an ordinary ROUTABLE non-dialogue shot",
      async () => {
        const [
          episode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest(
            "EP90",
          ),
          loadContext(),
        ]);

        const shot =
          requireShot(
            episode,
            "S01",
          );

        const result =
          evaluateShotExecutionReadiness(
            episode,
            shot,
            context.bible,
            context.rules,
            context.policy,
            {
              provider:
                "RUNWAY",

              source:
                "DURABLE_DIALOGUE_VISUAL_AUTHORIZATION",
            },
          );

        expect(
          result.routing.disposition,
        ).toBe(
          "ROUTABLE",
        );

        expect(
          result.disposition,
        ).toBe(
          "BLOCKED",
        );

        expect(
          result.executionProvider,
        ).toBeNull();

        expect(
          result.blockers.join(
            " ",
          ),
        ).toMatch(
          /cannot be applied when routing disposition is ROUTABLE/i,
        );
      },
    );
  },
);
