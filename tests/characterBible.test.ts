import { describe, expect, it } from "vitest";

import { loadCharacterBible } from "../src/validation/loadCharacterBible.js";

describe("Busybookie Character Bible", () => {
  it("loads the authoritative core character configuration", async () => {
    const bible = await loadCharacterBible();

    expect(bible.schemaVersion).toBe("2.0");

    expect(
      bible.characters.map((character) => character.id),
    ).toEqual(
      expect.arrayContaining([
        "OLLIE",
        "KACEY",
        "MONT",
      ]),
    );
  });

  it("locks the approved character gender identities", async () => {
    const bible = await loadCharacterBible();

    const genders = Object.fromEntries(
      bible.characters.map((character) => [
        character.id,
        character.gender,
      ]),
    );

    expect(genders).toMatchObject({
      OLLIE: "BOY",
      KACEY: "GIRL",
      MONT: "BOY",
    });
  });

  it("locks the approved pronouns", async () => {
    const bible = await loadCharacterBible();

    const ollie = bible.characters.find(
      (character) => character.id === "OLLIE",
    );

    const kacey = bible.characters.find(
      (character) => character.id === "KACEY",
    );

    const mont = bible.characters.find(
      (character) => character.id === "MONT",
    );

    expect(ollie?.pronouns.subject).toBe("he");
    expect(kacey?.pronouns.subject).toBe("she");
    expect(mont?.pronouns.subject).toBe("he");
  });

  it("locks Ollie to the approved Runway reference-audio identity while retaining Kacey's locked voice", async () => {
    const bible = await loadCharacterBible();

    const ollie = bible.characters.find(
      (character) => character.id === "OLLIE",
    );

    const kacey = bible.characters.find(
      (character) => character.id === "KACEY",
    );

    expect(ollie?.voice).toEqual({
      selectionStatus: "LOCKED",
      provider: "RUNWAY",
      voiceName: "Ollie",
      deliveryTraits: [
        "young",
        "curious",
        "warm",
        "friendly",
        "natural",
      ],
      executionMode: "RUNWAY_REFERENCE_AUDIO",
      referenceAudio: {
        assetId: "OLLIE_VOICE_REFERENCE_V1",
        mediaRootRelativePath:
          "references/voices/OLLIE/ollie-reference-v1.mp3",
        bytes: 231_593,
        sha256:
          "ad7bc6a50675bddc74a4885f290667fad1076c5cd3d9844eb7ff2d84b0f94a2f",
        contentType: "audio/mpeg",
        durationSeconds: 14.4,
        codecName: "mp3",
        sampleRateHz: 44_100,
        channels: 1,
      },
    });

    expect(kacey?.voice).toEqual({
      selectionStatus: "LOCKED",
      provider: "RUNWAY",
      voiceName: "Maya",
      deliveryTraits: [
        "young",
        "warm",
        "thoughtful",
        "friendly",
        "clear",
      ],
    });
  });

  it("locks Mont Runway voice to Noah", async () => {
    const bible = await loadCharacterBible();

    const mont = bible.characters.find(
      (character) => character.id === "MONT",
    );

    expect(mont?.gender).toBe("BOY");

    expect(mont?.voice).toEqual({
      selectionStatus: "LOCKED",
      provider: "RUNWAY",
      voiceName: "Noah",
      deliveryTraits: [
        "young male",
        "gentle",
        "soft",
        "calm",
        "slightly shy",
        "reassuring",
        "natural",
      ],
    });
  });

  it("preserves each character species contract", async () => {
    const bible = await loadCharacterBible();

    const species = Object.fromEntries(
      bible.characters.map((character) => [
        character.id,
        character.species,
      ]),
    );

    expect(species).toMatchObject({
      OLLIE: "young otter",
      KACEY: "young fox",
      MONT: "young elephant",
    });
  });
});
