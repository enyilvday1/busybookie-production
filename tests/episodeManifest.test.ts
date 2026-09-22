import { describe, expect, it } from "vitest";

import {
  EpisodeManifestSchema,
} from "../src/schemas/episodeManifest.schema.js";

import { loadCharacterBible } from "../src/validation/loadCharacterBible.js";
import { loadEpisodeManifest } from "../src/validation/loadEpisodeManifest.js";
import { loadProductionRules } from "../src/validation/loadProductionRules.js";
import { validateEpisodeProduction } from "../src/validation/validateEpisodeProduction.js";

describe("Busybookie Episode Manifest", () => {
  it("loads the development EP02 manifest", async () => {
    const episode =
      await loadEpisodeManifest("EP02");

    expect(episode.episodeId).toBe("EP02");
    expect(episode.status).toBe("DRAFT");
    expect(episode.scenes).toHaveLength(1);
    expect(episode.scenes[0]?.shots).toHaveLength(2);
  });

  it("keeps global shot order continuous", async () => {
    const episode =
      await loadEpisodeManifest("EP02");

    const orders =
      episode.scenes.flatMap(
        (scene) =>
          scene.shots.map(
            (shot) => shot.order,
          ),
      );

    expect(orders).toEqual([
      1,
      2,
    ]);
  });

  it("rejects dialogue from a character absent from the shot", () => {
    const result =
      EpisodeManifestSchema.safeParse({
        schemaVersion: "1.0",
        episodeId: "EP99",
        title: "Invalid Dialogue Test",
        slug: "invalid-dialogue-test",
        status: "DRAFT",
        audience: {
          description: "preschool children",
          minAgeYears: 2,
          maxAgeYears: 5
        },
        learningGoals: [
          "testing"
        ],
        emotionalTheme: "testing",
        targetDurationSeconds: 60,
        approvals: {
          script: "PENDING",
          storyboard: "PENDING",
          references: "PENDING",
          roughCut: "PENDING",
          finalQc: "PENDING"
        },
        scenes: [
          {
            id: "SC01",
            title: "Test",
            summary: "Test scene",
            shots: [
              {
                id: "S01",
                order: 1,
                title: "Invalid speaker",
                type: "DIALOGUE",
                durationSeconds: 5,
                characters: [
                  "OLLIE"
                ],
                visualAction: "Ollie stands still.",
                camera: "Static medium shot.",
                dialogue: [
                  {
                    characterId: "KACEY",
                    text: "Hello."
                  }
                ],
                audio: {
                  sfx: []
                },
                references: {
                  required: false,
                  assetIds: [],
                  approvalStatus: "NOT_REQUIRED"
                },
                generation: {
                  provider: "MANUAL",
                  nativeAudio: false,
                  status: "PLANNED"
                },
                continuityNotes: []
              }
            ]
          }
        ]
      });

    expect(result.success).toBe(false);
  });

  it("allows a draft episode while approvals remain pending", async () => {
    const [
      episode,
      bible,
      rules,
    ] = await Promise.all([
      loadEpisodeManifest("EP02"),
      loadCharacterBible(),
      loadProductionRules(),
    ]);

    expect(() =>
      validateEpisodeProduction(
        episode,
        bible,
        rules,
      ),
    ).not.toThrow();
  });

  it("blocks generation when a speaking character has no locked voice", async () => {
    const [
      source,
      bible,
      rules,
    ] = await Promise.all([
      loadEpisodeManifest("EP02"),
      loadCharacterBible(),
      loadProductionRules(),
    ]);

    const episode =
      structuredClone(source);

    episode.status =
      "READY_FOR_GENERATION";

    episode.approvals.script =
      "APPROVED";

    episode.approvals.storyboard =
      "APPROVED";

    episode.approvals.references =
      "APPROVED";

    const shot =
      episode.scenes[0]?.shots[1];

    if (!shot) {
      throw new Error(
        "Expected test shot S02.",
      );
    }

    shot.characters = [
      "MONT",
    ];

    shot.dialogue = [
      {
        characterId: "MONT",
        text: "Hello."
      }
    ];

    shot.references = {
      required: true,
      assetIds: [
        "mont-reference-001",
      ],
      approvalStatus: "APPROVED",
    };

    shot.generation.status =
      "APPROVED_FOR_GENERATION";

    const testBible =
      structuredClone(
        bible,
      );

    const mont =
      testBible.characters.find(
        (character) =>
          character.id ===
          "MONT",
      );

    if (!mont) {
      throw new Error(
        "Expected Mont in Character Bible.",
      );
    }

    mont.voice = {
      selectionStatus:
        "PENDING",
      provider:
        "RUNWAY",
      voiceName:
        null,
      deliveryTraits: [
        ...mont.voice
          .deliveryTraits,
      ],
    };

    expect(() =>
      validateEpisodeProduction(
        episode,
        testBible,
        rules,
      ),
    ).toThrow(
      /Mont requires dialogue but no approved voice is locked/,
    );
  });

  it("allows generation for a speaking character with a locked voice", async () => {
    const [
      source,
      bible,
      rules,
    ] = await Promise.all([
      loadEpisodeManifest("EP02"),
      loadCharacterBible(),
      loadProductionRules(),
    ]);

    const episode =
      structuredClone(source);

    episode.status =
      "READY_FOR_GENERATION";

    episode.approvals.script =
      "APPROVED";

    episode.approvals.storyboard =
      "APPROVED";

    episode.approvals.references =
      "APPROVED";

    const shot =
      episode.scenes[0]?.shots[1];

    if (!shot) {
      throw new Error(
        "Expected test shot S02.",
      );
    }

    shot.references = {
      required: true,
      assetIds: [
        "ollie-reference-001",
      ],
      approvalStatus: "APPROVED",
    };

    shot.generation.status =
      "APPROVED_FOR_GENERATION";

    expect(() =>
      validateEpisodeProduction(
        episode,
        bible,
        rules,
      ),
    ).not.toThrow();
  });
});
