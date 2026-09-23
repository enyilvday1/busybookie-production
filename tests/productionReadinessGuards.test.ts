import {
  describe,
  expect,
  it,
} from "vitest";

import {
  assertRunwayGen45ShotReady,
  findEpisodeShot,
} from "../src/runway/cli/assertRunwayGen45ShotReady.js";

import {
  assertVeoShotReady,
  findVeoEpisodeShot,
} from "../src/veo/cli/assertVeoShotReady.js";

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
  validateEpisodeProduction,
} from "../src/validation/validateEpisodeProduction.js";

describe(
  "Busybookie production readiness guards",
  () => {
    it(
      "requires script approval for a generation-ready episode",
      async () => {
        const [
          source,
          bible,
          rules,
        ] = await Promise.all([
          loadEpisodeManifest("EP90"),
          loadCharacterBible(),
          loadProductionRules(),
        ]);

        const episode =
          structuredClone(source);

        episode.approvals.script =
          "PENDING";

        expect(() =>
          validateEpisodeProduction(
            episode,
            bible,
            rules,
          ),
        ).toThrow(
          /script approval is required/,
        );
      },
    );

    it(
      "requires storyboard approval for a generation-ready episode",
      async () => {
        const [
          source,
          bible,
          rules,
        ] = await Promise.all([
          loadEpisodeManifest("EP90"),
          loadCharacterBible(),
          loadProductionRules(),
        ]);

        const episode =
          structuredClone(source);

        episode.approvals.storyboard =
          "PENDING";

        expect(() =>
          validateEpisodeProduction(
            episode,
            bible,
            rules,
          ),
        ).toThrow(
          /storyboard approval is required/,
        );
      },
    );

    it(
      "requires episode reference approval for generation",
      async () => {
        const [
          source,
          bible,
          rules,
        ] = await Promise.all([
          loadEpisodeManifest("EP90"),
          loadCharacterBible(),
          loadProductionRules(),
        ]);

        const episode =
          structuredClone(source);

        episode.approvals.references =
          "PENDING";

        expect(() =>
          validateEpisodeProduction(
            episode,
            bible,
            rules,
          ),
        ).toThrow(
          /reference approval is required/,
        );
      },
    );

    it(
      "rejects a shot whose provider is not enabled",
      async () => {
        const [
          episode,
          bible,
          sourceRules,
        ] = await Promise.all([
          loadEpisodeManifest("EP90"),
          loadCharacterBible(),
          loadProductionRules(),
        ]);

        const rules =
          structuredClone(sourceRules);

        const shot =
          findEpisodeShot(
            episode,
            "S01",
          );

        rules.generation.supportedProviders =
          rules.generation.supportedProviders.filter(
            (provider) =>
              provider !==
              shot.generation.provider,
          );

        expect(() =>
          validateEpisodeProduction(
            episode,
            bible,
            rules,
          ),
        ).toThrow(
          /provider RUNWAY is not enabled/,
        );
      },
    );

    it(
      "requires approval for a required shot reference",
      async () => {
        const [
          source,
          bible,
          rules,
        ] = await Promise.all([
          loadEpisodeManifest("EP90"),
          loadCharacterBible(),
          loadProductionRules(),
        ]);

        const episode =
          structuredClone(source);

        const shot =
          findEpisodeShot(
            episode,
            "S01",
          );

        shot.references.approvalStatus =
          "PENDING";

        expect(() =>
          validateEpisodeProduction(
            episode,
            bible,
            rules,
          ),
        ).toThrow(
          /required references are not approved/,
        );
      },
    );


    it(
      "blocks Runway when the episode is not live for generation",
      async () => {
        const episode =
          structuredClone(
            await loadEpisodeManifest("EP90"),
          );

        episode.status = "DRAFT";

        const shot =
          findEpisodeShot(
            episode,
            "S01",
          );

        expect(() =>
          assertRunwayGen45ShotReady(
            episode,
            shot,
          ),
        ).toThrow(
          /status is DRAFT/,
        );
      },
    );

    it(
      "blocks Runway when the manifest provider is not RUNWAY",
      async () => {
        const episode =
          structuredClone(
            await loadEpisodeManifest("EP90"),
          );

        const shot =
          findEpisodeShot(
            episode,
            "S01",
          );

        shot.generation.provider =
          "VEO";

        expect(() =>
          assertRunwayGen45ShotReady(
            episode,
            shot,
          ),
        ).toThrow(
          /provider is VEO/,
        );
      },
    );

    it(
      "blocks Runway unless the shot is approved for generation",
      async () => {
        const episode =
          structuredClone(
            await loadEpisodeManifest("EP90"),
          );

        const shot =
          findEpisodeShot(
            episode,
            "S01",
          );

        shot.generation.status =
          "PLANNED";

        expect(() =>
          assertRunwayGen45ShotReady(
            episode,
            shot,
          ),
        ).toThrow(
          /status is PLANNED/,
        );
      },
    );

    it(
      "blocks Runway when native audio is requested",
      async () => {
        const episode =
          structuredClone(
            await loadEpisodeManifest("EP90"),
          );

        const shot =
          findEpisodeShot(
            episode,
            "S01",
          );

        shot.generation.nativeAudio =
          true;

        expect(() =>
          assertRunwayGen45ShotReady(
            episode,
            shot,
          ),
        ).toThrow(
          /requests native audio/,
        );
      },
    );

    it(
      "blocks Runway when the shot contains dialogue",
      async () => {
        const episode =
          structuredClone(
            await loadEpisodeManifest("EP90"),
          );

        const shot =
          findEpisodeShot(
            episode,
            "S01",
          );

        shot.dialogue = [
          {
            characterId: "OLLIE",
            text: "Hello!",
          },
        ];

        expect(() =>
          assertRunwayGen45ShotReady(
            episode,
            shot,
          ),
        ).toThrow(
          /contains dialogue/,
        );
      },
    );

    it(
      "blocks Runway when required references are not approved",
      async () => {
        const episode =
          structuredClone(
            await loadEpisodeManifest("EP90"),
          );

        const shot =
          findEpisodeShot(
            episode,
            "S01",
          );

        shot.references.required =
          true;

        shot.references.approvalStatus =
          "PENDING";

        expect(() =>
          assertRunwayGen45ShotReady(
            episode,
            shot,
          ),
        ).toThrow(
          /references are not approved/,
        );
      },
    );


    it(
      "blocks Veo when the episode is not live for generation",
      async () => {
        const episode =
          structuredClone(
            await loadEpisodeManifest("EP91"),
          );

        episode.status = "DRAFT";

        const shot =
          findVeoEpisodeShot(
            episode,
            "S01",
          );

        expect(() =>
          assertVeoShotReady(
            episode,
            shot,
          ),
        ).toThrow(
          /status is DRAFT/,
        );
      },
    );

    it(
      "blocks Veo unless the shot is approved for generation",
      async () => {
        const episode =
          structuredClone(
            await loadEpisodeManifest("EP91"),
          );

        const shot =
          findVeoEpisodeShot(
            episode,
            "S01",
          );

        shot.generation.status =
          "PLANNED";

        expect(() =>
          assertVeoShotReady(
            episode,
            shot,
          ),
        ).toThrow(
          /status is PLANNED/,
        );
      },
    );

    it(
      "blocks Veo when native audio is not requested",
      async () => {
        const episode =
          structuredClone(
            await loadEpisodeManifest("EP91"),
          );

        const shot =
          findVeoEpisodeShot(
            episode,
            "S01",
          );

        shot.generation.nativeAudio =
          false;

        expect(() =>
          assertVeoShotReady(
            episode,
            shot,
          ),
        ).toThrow(
          /does not request native audio/,
        );
      },
    );

    it(
      "blocks Veo when no required reference image is declared",
      async () => {
        const episode =
          structuredClone(
            await loadEpisodeManifest("EP91"),
          );

        const shot =
          findVeoEpisodeShot(
            episode,
            "S01",
          );

        shot.references.required =
          false;

        expect(() =>
          assertVeoShotReady(
            episode,
            shot,
          ),
        ).toThrow(
          /does not declare a required reference image/,
        );
      },
    );

    it(
      "blocks Veo when required references are not approved",
      async () => {
        const episode =
          structuredClone(
            await loadEpisodeManifest("EP91"),
          );

        const shot =
          findVeoEpisodeShot(
            episode,
            "S01",
          );

        shot.references.approvalStatus =
          "PENDING";

        expect(() =>
          assertVeoShotReady(
            episode,
            shot,
          ),
        ).toThrow(
          /references are not approved/,
        );
      },
    );

  },
);
