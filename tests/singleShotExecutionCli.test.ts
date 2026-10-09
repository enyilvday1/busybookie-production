import {
  createHash,
} from "node:crypto";

import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
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
  runSingleShotExecutionCli,
  type RunSingleShotExecutionCliDependencies,
} from "../src/execution/cli/runSingleShotExecutionCli.js";

import {
  createProductionSingleShotExecutionDependencies,
} from "../src/execution/createProductionSingleShotExecutionDependencies.js";

import {
  createExecutionReservation,
} from "../src/execution/createExecutionReservation.js";

import {
  createExecutionSubmission,
} from "../src/execution/createExecutionSubmission.js";

import {
  createExecutionCompletion,
} from "../src/execution/createExecutionCompletion.js";

import {
  createProductionVisualReferenceVerifier,
} from "../src/execution/createProductionVisualReferenceVerifier.js";

import {
  createVisualReferenceAssetRegistryPath,
} from "../src/execution/visualReferenceAssetRegistryPath.js";

import {
  executeSingleShot,
} from "../src/execution/executeSingleShot.js";

import {
  inspectExecutionLifecycle,
} from "../src/execution/inspectExecutionLifecycle.js";

import {
  createExecutionSubmissionPath,
} from "../src/execution/executionSubmissionPath.js";

import {
  createDialogueVisualAuthorizationPath,
} from "../src/execution/dialogueVisualAuthorizationPath.js";

import type {
  SingleShotProviderExecutor,
} from "../src/execution/singleShotExecution.types.js";

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

import {
  validateEpisodeProduction,
} from "../src/validation/validateEpisodeProduction.js";

const directories: string[] = [];
afterEach(
  async () => {
    vi.restoreAllMocks();
    for (
      const directory of directories.splice(
        0
      )
    ) {
      await rm(
        directory,
        {
          recursive: true,
          force: true
        }
      );
    }
  }
);

async function fixture() {
  const root = await mkdtemp(
    join(
      tmpdir(),
      "busybookie-secured-cli-"
    )
  );
  directories.push(
    root
  );

  const episode = await loadEpisodeManifest(
    "EP90"
  );

  const bible = await loadCharacterBible();

  const events: string[] = [];

  const imagePath = join(
    root,
    "references",
    "source.png"
  );

  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZbQAAAABJRU5ErkJggg==",
    "base64"
  );

  await mkdir(
    join(
      root,
      "references"
    )
  );

  await writeFile(
    imagePath,
    bytes
  );

  const registry = {
    schemaVersion: "1.0",
    assets: [
      {
        assetId: episode.scenes[0]!.shots[0]!.references.assetIds[0]!,
        mediaRootRelativePath: "references/source.png",
        bytes: bytes.length,
        sha256: createHash(
          "sha256"
        ).update(
          bytes
        ).digest(
          "hex"
        ),
        contentType: "image/png",
      }
    ],
  };

  const registryPath = createVisualReferenceAssetRegistryPath(
    root
  );

  const writeRegistry = () => writeFile(
    registryPath,
    JSON.stringify(
      registry
    )
  );

  const verify = createProductionVisualReferenceVerifier();

  const verifyVisualReference = vi.fn<typeof verify>(
    async (
      input
    ) => {
      events.push(
        "verify"
      );

      return verify(
        input
      );
    }
  );

  const reserve = vi.fn<typeof createExecutionReservation>(
    async (
      ...input
    ) => {
      events.push(
        "reservation"
      );

      return createExecutionReservation(
        ...input
      );
    }
  );

  const submit = vi.fn<typeof createExecutionSubmission>(
    async (
      ...input
    ) => {
      events.push(
        "submission"
      );

      return createExecutionSubmission(
        ...input
      );
    }
  );

  const complete = vi.fn<typeof createExecutionCompletion>(
    async (
      ...input
    ) => {
      events.push(
        "completion"
      );

      return createExecutionCompletion(
        ...input
      );
    }
  );

  const provider = vi.fn<SingleShotProviderExecutor>(
    async (
      input
    ) => {
      events.push(
        "provider"
      );

      expect(
        input.sourceImagePath
      ).toBe(
        await realpath(
          imagePath
        )
      );

      expect(
        (
          await inspectExecutionLifecycle(
            root,
            "EP90",
            "S01"
          )
        ).state
      ).toBe(
        "RESERVED_ONLY"
      );

      await input.onSubmissionAccepted({
        provider: "RUNWAY",
        providerExecutionId: "controlled-task",
        providerEstimatedCredits: 60,
        recoveryMetadata: {
          request: {
            durationSeconds: 5,
            ratio: "1280:720",
            outputFormat: "mp4",
            promptText: "Controlled test",
            sourceImagePath: input.sourceImagePath,
            assetStrategy: "DATA_URI"
          },
          locallyExpectedCredits: 60,
        },
      });

      expect(
        (
          await inspectExecutionLifecycle(
            root,
            "EP90",
            "S01"
          )
        ).state
      ).toBe(
        "SUBMITTED"
      );

      const recordPath = join(
        root,
        "generated-video",
        "EP90",
        "S01",
        "test.runway-generation.json"
      );

      await writeFile(
        recordPath,
        "{}"
      );

      return {
        providerExecutionId: "controlled-task",
        recordPath
      };
    }
  );

  const prepareRunwayExecutor = vi.fn(
    async () => {
      events.push(
        "prepare"
      );

      return provider;
    }
  );

  const prepareVeoExecutor = vi.fn(
    async () => {
      throw new Error(
        "Unexpected Veo preparation"
      );
    }
  );

  const createDependencies = vi.fn<typeof createProductionSingleShotExecutionDependencies>(
    (
      credentials
    ) =>
    createProductionSingleShotExecutionDependencies(
      credentials,
      {
        verifyVisualReference,
        createReservation: reserve,
        createSubmission: submit,
        createCompletion: complete,
        prepareRunwayExecutor,
        prepareVeoExecutor,
      }
    )
  );

  const dependencies: RunSingleShotExecutionCliDependencies = {
    loadEnvironment: () => ({
      BUSYBOOKIE_MEDIA_ROOT: root
    }),
    loadEpisodeManifest: async () => episode,
    loadCharacterBible: async () => bible,
    loadProductionRules,
    loadProviderRoutingPolicy,
    validateEpisodeProduction,
    validateMediaRoot: vi.fn(
      async () => root
    ),
    inspectExecutionLifecycle,
    createDependencies,
    executeSingleShot: vi.fn(
      executeSingleShot
    ),
  };

  const args = [
    "--episode",
    "EP90",
    "--shot",
    "S01",
    "--image",
    imagePath,
    "--confirm-paid-generation"
  ];
  vi.spyOn(
    console,
    "log"
  ).mockImplementation(
    () => undefined
  );

  const expectNoExecution = () => {
    expect(
      reserve
    ).not.toHaveBeenCalled();

    expect(
      provider
    ).not.toHaveBeenCalled();

    expect(
      prepareRunwayExecutor
    ).not.toHaveBeenCalled();

    expect(
      prepareVeoExecutor
    ).not.toHaveBeenCalled();

    expect(
      submit
    ).not.toHaveBeenCalled();

    expect(
      complete
    ).not.toHaveBeenCalled();
  };

  return {
    root,
    episode,
    bible,
    events,
    args,
    registry,
    registryPath,
    writeRegistry,
    dependencies,
    createDependencies,
    verifyVisualReference,
    reserve,
    provider,
    expectNoExecution
  };
}

describe(
  "secured single-shot production CLI",
  () => {
    it(
      "uses production composition and the real secured executor through durable completion",
      async () => {
        const f = await fixture();

        await f.writeRegistry();

        await runSingleShotExecutionCli(
          f.args,
          f.dependencies
        );

        expect(
          f.createDependencies
        ).toHaveBeenCalledExactlyOnceWith({});

        expect(
          f.dependencies.executeSingleShot
        ).toHaveBeenCalledTimes(
          1
        );

        expect(
          f.events
        ).toEqual([
          "verify",
          "prepare",
          "reservation",
          "provider",
          "submission",
          "completion"
        ]);

        expect(
          (
            await inspectExecutionLifecycle(
              f.root,
              "EP90",
              "S01"
            )
          ).state
        ).toBe(
          "COMPLETED"
        );

        await expect(
          runSingleShotExecutionCli(
            f.args,
            f.dependencies
          )
        ).rejects.toThrow(
          /COMPLETED.*execution:reconcile/
        );

        expect(
          f.provider
        ).toHaveBeenCalledTimes(
          1
        );
      }
    );

    it(
      "requires explicit confirmation before visual verification or provider preparation",
      async () => {
        const f = await fixture();

        await expect(
          runSingleShotExecutionCli(
            f.args.slice(
              0,
              -1
            ),
            f.dependencies
          )
        ).rejects.toThrow(
          /Paid-generation confirmation/
        );

        expect(
          f.verifyVisualReference
        ).not.toHaveBeenCalled();

        f.expectNoExecution();
      }
    );

    it.each([
      "missing",
      "malformed",
      "hash mismatch",
      "unapproved"
    ])(
      "fails closed for %s registry evidence",
      async (
        mode
      ) => {
        const f = await fixture();

        if (
          mode === "malformed"
        )
          await writeFile(
            f.registryPath,
            "{}"
          );

        if (
          mode === "hash mismatch"
        ) {
          f.registry.assets[0]!.sha256 = "0".repeat(
            64
          );

          await f.writeRegistry();
        }
        if (
          mode === "unapproved"
        ) {
          f.registry.assets[0]!.assetId = "unapproved-asset";

          await f.writeRegistry();
        }
        await expect(
          runSingleShotExecutionCli(
            f.args,
            f.dependencies
          )
        ).rejects.toThrow();

        expect(
          f.verifyVisualReference
        ).toHaveBeenCalledTimes(
          1
        );

        f.expectNoExecution();

        expect(
          (
            await inspectExecutionLifecycle(
              f.root,
              "EP90",
              "S01"
            )
          ).state
        ).toBe(
          "NOTHING"
        );
      }
    );

    it(
      "blocks an existing reservation even when no submission exists",
      async () => {
        const f = await fixture();

        const reservation = await createExecutionReservation(
          f.root,
          {
            episodeId: "EP90",
            shotId: "S01",
            provider: "RUNWAY"
          }
        );

        const before = await readFile(
          reservation.reservationPath,
          "utf8"
        );

        await expect(
          runSingleShotExecutionCli(
            f.args,
            f.dependencies
          )
        ).rejects.toThrow(
          /RESERVED_ONLY.*execution:reconcile/
        );

        expect(
          await readFile(
            reservation.reservationPath,
            "utf8"
          )
        ).toBe(
          before
        );

        expect(
          f.createDependencies
        ).not.toHaveBeenCalled();

        f.expectNoExecution();
      }
    );

    it(
      "blocks malformed/orphaned lifecycle evidence with reconciliation guidance",
      async () => {
        const f = await fixture();

        await mkdir(
          join(
            f.root,
            "generated-video",
            "EP90",
            "S01"
          ),
          {
            recursive: true
          }
        );

        await writeFile(
          createExecutionSubmissionPath(
            f.root,
            "EP90",
            "S01"
          ),
          "{}"
        );

        await expect(
          runSingleShotExecutionCli(
            f.args,
            f.dependencies
          )
        ).rejects.toThrow(
          /execution:reconcile/
        );

        expect(
          f.createDependencies
        ).not.toHaveBeenCalled();

        f.expectNoExecution();
      }
    );

    it(
      "the exclusive reservation still blocks a race after lifecycle inspection",
      async () => {
        const f = await fixture();

        await f.writeRegistry();

        const dependencies = {
          ...f.dependencies,
          inspectExecutionLifecycle: vi.fn<typeof inspectExecutionLifecycle>(
            async () => {
              await createExecutionReservation(
                f.root,
                {
                  episodeId: "EP90",
                  shotId: "S01",
                  provider: "RUNWAY"
                }
              );

              return {
                state: "NOTHING"
              };
            }
          )
        };

        await expect(
          runSingleShotExecutionCli(
            f.args,
            dependencies
          )
        ).rejects.toThrow(
          /reservation already exists.*execution:reconcile/
        );

        expect(
          f.provider
        ).not.toHaveBeenCalled();

        expect(
          (
            await inspectExecutionLifecycle(
              f.root,
              "EP90",
              "S01"
            )
          ).state
        ).toBe(
          "RESERVED_ONLY"
        );
      }
    );

    it(
      "rejects production validation failure before admission",
      async () => {
        const f = await fixture();

        f.episode.approvals.script = "PENDING";

        await expect(
          runSingleShotExecutionCli(
            f.args,
            f.dependencies
          )
        ).rejects.toThrow(
          /script approval/
        );

        expect(
          f.createDependencies
        ).not.toHaveBeenCalled();

        f.expectNoExecution();
      }
    );

    it.each([
      "missing",
      "invalid"
    ])(
      "fails closed for %s required durable dialogue authorization",
      async (
        mode
      ) => {
        const f = await fixture();

        const episode = await loadEpisodeManifest(
          "EP02"
        );
        episode.status = "READY_FOR_GENERATION";
        episode.approvals.script = "APPROVED";
        episode.approvals.storyboard = "APPROVED";
        episode.approvals.references = "APPROVED";

        const shot = episode.scenes.flatMap(
          (
            scene
          ) => scene.shots
        ).find(
          (
            candidate
          ) => candidate.id === "S02"
        )!;
        shot.references = {
          required: true,
          assetIds: [
            "OLLIE_CHARACTER_MASTER_REFERENCE_V1"
          ],
          approvalStatus: "APPROVED"
        };
        shot.generation.provider = "VEO";
        shot.generation.nativeAudio = true;
        shot.generation.status = "APPROVED_FOR_GENERATION";

        const ollie = f.bible.characters.find(
          (
            character
          ) => character.id === "OLLIE"
        )!;
        ollie.voice = {
          selectionStatus: "LOCKED",
          provider: "RUNWAY",
          voiceName: "Chad",
          deliveryTraits: [
            ...ollie.voice.deliveryTraits
          ]
        };

        if (
          mode === "invalid"
        ) {
          await mkdir(
            join(
              f.root,
              "generated-video",
              "EP02",
              "S02"
            ),
            {
              recursive: true
            }
          );

          await writeFile(
            createDialogueVisualAuthorizationPath(
              f.root,
              "EP02",
              "S02"
            ),
            "{}"
          );
        }
        const args = [
          ...f.args
        ];
        args[1] = "EP02";
        args[3] = "S02";

        await expect(
          runSingleShotExecutionCli(
            args,
            {
              ...f.dependencies,
              loadEpisodeManifest: async () => episode
            }
          )
        ).rejects.toThrow(
          mode === "missing"
            ? /MANUAL_REVIEW/
            : /authorization/i
        );

        expect(
          f.dependencies.executeSingleShot
        ).toHaveBeenCalledTimes(
          1
        );

        expect(
          f.verifyVisualReference
        ).not.toHaveBeenCalled();

        f.expectNoExecution();
      }
    );

    it(
      "does not resubmit after provider failure leaves durable submission evidence",
      async () => {
        const f = await fixture();

        await f.writeRegistry();

        f.provider.mockImplementationOnce(
          async (
            input
          ) => {
            await input.onSubmissionAccepted({
              provider: "RUNWAY",
              providerExecutionId: "accepted-before-failure",
              providerEstimatedCredits: 60,
              recoveryMetadata: {
                request: {
                  durationSeconds: 5,
                  ratio: "1280:720",
                  outputFormat: "mp4",
                  promptText: "Controlled test",
                  sourceImagePath: input.sourceImagePath,
                  assetStrategy: "DATA_URI"
                },
                locallyExpectedCredits: 60
              },
            });
            throw new Error(
              "Controlled wait failure"
            );
          }
        );

        await expect(
          runSingleShotExecutionCli(
            f.args,
            f.dependencies
          )
        ).rejects.toThrow(
          /Controlled wait failure.*execution:reconcile/
        );

        expect(
          (
            await inspectExecutionLifecycle(
              f.root,
              "EP90",
              "S01"
            )
          ).state
        ).toBe(
          "SUBMITTED"
        );

        await expect(
          runSingleShotExecutionCli(
            f.args,
            f.dependencies
          )
        ).rejects.toThrow(
          /SUBMITTED.*execution:reconcile/
        );

        expect(
          f.provider
        ).toHaveBeenCalledTimes(
          1
        );
      }
    );
  }
);
