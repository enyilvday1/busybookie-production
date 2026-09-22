import { describe, expect, it } from "vitest";

import { loadCharacterBible } from "../src/validation/loadCharacterBible.js";

describe("Busybookie Character Bible", () => {
  it("loads the authoritative main character configuration", async () => {
    const bible = await loadCharacterBible();

    expect(bible.schemaVersion).toBe("1.0");
    expect(bible.characters).toHaveLength(3);

    expect(
      bible.characters.map((character) => character.id),
    ).toEqual([
      "OLLIE",
      "KACEY",
      "MONT",
    ]);
  });

  it("locks the approved character gender identities", async () => {
    const bible = await loadCharacterBible();

    const genders = Object.fromEntries(
      bible.characters.map((character) => [
        character.id,
        character.gender,
      ]),
    );

    expect(genders).toEqual({
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

  it("locks Ollie and Kacey Runway voices", async () => {
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
      voiceName: "Chad",
      deliveryTraits: [
        "young",
        "curious",
        "warm",
        "friendly",
        "natural",
      ],
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

    expect(species).toEqual({
      OLLIE: "young otter",
      KACEY: "young fox",
      MONT: "young elephant",
    });
  });
});
