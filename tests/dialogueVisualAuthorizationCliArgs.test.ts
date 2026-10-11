import {
  describe,
  expect,
  it,
} from "vitest";

import {
  parseDialogueVisualAuthorizationCliArgs,
} from "../src/dialogue/cli/dialogueVisualAuthorizationCliArgs.js";

const args = [
  "--episode", "EP02",
  "--shot", "S02",
  "--provider", "RUNWAY",
];

describe("dialogue visual authorization arguments", () => {
  it.each(["RUNWAY", "VEO"])("accepts %s with confirmation", (provider) => {
    const options = parseDialogueVisualAuthorizationCliArgs([
      ...args.slice(0, 4), "--provider", provider,
      "--confirm-authorization",
    ]);

    expect(options).toEqual({
      episodeId: "EP02",
      shotId: "S02",
      provider,
      confirmAuthorization: true,
    });
    expect(Object.isFrozen(options)).toBe(true);
  });

  it("defaults confirmation to false", () => {
    expect(
      parseDialogueVisualAuthorizationCliArgs(args).confirmAuthorization,
    ).toBe(false);
  });

  it.each(["--episode", "--shot", "--provider"])("requires %s", (flag) => {
    const index = args.indexOf(flag);
    const incomplete = args.filter((_, i) => i !== index && i !== index + 1);

    expect(() => parseDialogueVisualAuthorizationCliArgs(incomplete))
      .toThrow(`${flag} is required.`);
  });

  it.each(["--episode", "--shot", "--provider"])("requires a value for %s", (flag) => {
    for (const suffix of [[], [" "], ["--confirm-authorization"]]) {
      expect(() => parseDialogueVisualAuthorizationCliArgs([flag, ...suffix]))
        .toThrow(`${flag} requires a value.`);
    }
  });

  it.each([
    "--unknown",
    "--purpose",
    "--native-audio-disposition",
    "--dialogue-authority",
    "--authorization-source",
    "--confirm-authorization=false",
  ])("rejects unsupported flag %s", (flag) => {
    expect(() => parseDialogueVisualAuthorizationCliArgs([...args, flag]))
      .toThrow(/Unknown dialogue visual authorization CLI argument/);
  });

  it.each(["--episode", "--shot", "--provider"])("rejects duplicate %s", (flag) => {
    expect(() => parseDialogueVisualAuthorizationCliArgs([...args, flag, "value"]))
      .toThrow(/Duplicate dialogue visual authorization CLI argument/);
  });

  it("rejects duplicate confirmation", () => {
    expect(() => parseDialogueVisualAuthorizationCliArgs([
      ...args, "--confirm-authorization", "--confirm-authorization",
    ])).toThrow(/Duplicate dialogue visual authorization CLI argument/);
  });

  it("does not accept a value after the confirmation flag", () => {
    expect(() => parseDialogueVisualAuthorizationCliArgs([
      ...args, "--confirm-authorization", "false",
    ])).toThrow(/Unknown dialogue visual authorization CLI argument: false/);
  });

  it.each(["KREA", "MANUAL", "runway"])("rejects provider %s", (provider) => {
    expect(() => parseDialogueVisualAuthorizationCliArgs([
      ...args.slice(0, 4), "--provider", provider,
    ])).toThrow();
  });

  it.each([0, 2])("validates canonical identity at argument index %s", (index) => {
    const invalid = [...args];
    invalid[index + 1] = "../escape";

    expect(() => parseDialogueVisualAuthorizationCliArgs(invalid)).toThrow();
  });
});
