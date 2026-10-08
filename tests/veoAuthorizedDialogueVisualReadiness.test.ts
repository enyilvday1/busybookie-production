import {
  describe,
  expect,
  it,
} from "vitest";

import {
  assertVeoShotReady,
} from "../src/veo/cli/assertVeoShotReady.js";

import {
  buildVeoPrompt,
} from "../src/veo/cli/buildVeoPrompt.js";

import type {
  EpisodeManifest,
  Shot,
} from "../src/schemas/episodeManifest.schema.js";

import {
  loadEpisodeManifest,
} from "../src/validation/loadEpisodeManifest.js";

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

async function makeReadyDialogueVisualFixture() {
  const episode =
    structuredClone(
      await loadEpisodeManifest(
        "EP02",
      ),
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

  shot.references = {
    required:
      true,

    assetIds: [
      "OLLIE_CHARACTER_MASTER_REFERENCE_V1",
    ],

    approvalStatus:
      "APPROVED",
  };

  shot.generation.provider =
    "VEO";

  shot.generation.nativeAudio =
    true;

  shot.generation.status =
    "APPROVED_FOR_GENERATION";

  return {
    episode,
    shot,
  };
}

describe(
  "Busybookie authorized Veo dialogue visual readiness",
  () => {
    it(
      "keeps the connectivity/default Veo readiness path dialogue-blocked",
      async () => {
        const {
          episode,
          shot,
        } =
          await makeReadyDialogueVisualFixture();

        expect(
          () =>
            assertVeoShotReady(
              episode,
              shot,
            ),
        ).toThrow(
          /contains dialogue/,
        );
      },
    );

    it(
      "admits dialogue only for the narrow durable-authorized visual-leg readiness mode",
      async () => {
        const {
          episode,
          shot,
        } =
          await makeReadyDialogueVisualFixture();

        expect(
          () =>
            assertVeoShotReady(
              episode,
              shot,
              "DURABLE_AUTHORIZED_DIALOGUE_VISUAL",
            ),
        ).not.toThrow();
      },
    );

    it(
      "does not let the authorized dialogue visual mode bypass generation approval",
      async () => {
        const {
          episode,
          shot,
        } =
          await makeReadyDialogueVisualFixture();

        shot.generation.status =
          "PLANNED";

        expect(
          () =>
            assertVeoShotReady(
              episode,
              shot,
              "DURABLE_AUTHORIZED_DIALOGUE_VISUAL",
            ),
        ).toThrow(
          /status is PLANNED/,
        );
      },
    );

    it(
      "does not let the authorized dialogue visual mode bypass reference approval",
      async () => {
        const {
          episode,
          shot,
        } =
          await makeReadyDialogueVisualFixture();

        shot.references.approvalStatus =
          "PENDING";

        expect(
          () =>
            assertVeoShotReady(
              episode,
              shot,
              "DURABLE_AUTHORIZED_DIALOGUE_VISUAL",
            ),
        ).toThrow(
          /references are not approved/,
        );
      },
    );

    it(
      "keeps authoritative dialogue text out of the current Veo production prompt",
      async () => {
        const {
          shot,
        } =
          await makeReadyDialogueVisualFixture();

        const prompt =
          buildVeoPrompt(
            shot,
          );

        expect(
          shot.dialogue.length,
        ).toBeGreaterThan(
          0,
        );

        for (
          const line
          of shot.dialogue
        ) {
          expect(
            prompt,
          ).not.toContain(
            line.text,
          );
        }

        expect(
          prompt,
        ).toContain(
          shot.visualAction,
        );

        expect(
          prompt,
        ).toContain(
          shot.camera,
        );
      },
    );
  },
);
