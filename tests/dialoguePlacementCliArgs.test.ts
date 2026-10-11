import {
  describe,
  expect,
  it,
} from "vitest";
import {
  parseDialoguePlacementCliArgs,
} from "../src/dialogue/cli/dialoguePlacementCliArgs.js";

const args = [
  "--episode", "EP02",
  "--scene", "SC01",
  "--shot", "S02",
  "--placements", "EP02_SC01_S02_L01=0.50",
];
const valueFlags = ["--episode", "--scene", "--shot", "--placements"];

describe("dialogue placement arguments", () => {
  it.each([0, 0.5])("accepts one line starting at %s", (startSeconds) => {
    const options = parseDialoguePlacementCliArgs([
      ...args.slice(0, 6), "--placements", `EP02_SC01_S02_L01=${startSeconds}`,
      "--confirm-placement",
    ]);

    expect(options).toEqual({
      episodeId: "EP02",
      sceneId: "SC01",
      shotId: "S02",
      placements: [{ dialogueLineId: "EP02_SC01_S02_L01", startSeconds }],
      confirmPlacement: true,
    });
    expect(Object.isFrozen(options)).toBe(true);
    expect(Object.isFrozen(options.placements)).toBe(true);
    expect(Object.isFrozen(options.placements[0])).toBe(true);
  });

  it("trims multiple entries, preserves operator order and defaults confirmation false", () => {
    const options = parseDialoguePlacementCliArgs([
      ...args.slice(0, 6), "--placements",
      " EP02_SC01_S02_L02 = 2.75 , EP02_SC01_S02_L01 = 0.50 ",
    ]);

    expect(options.placements).toEqual([
      { dialogueLineId: "EP02_SC01_S02_L02", startSeconds: 2.75 },
      { dialogueLineId: "EP02_SC01_S02_L01", startSeconds: 0.5 },
    ]);
    expect(options.confirmPlacement).toBe(false);
    expect(options.placements.every(Object.isFrozen)).toBe(true);
  });

  it.each(valueFlags)("requires %s", (flag) => {
    const index = args.indexOf(flag);
    const incomplete = args.filter((_, i) => i !== index && i !== index + 1);
    expect(() => parseDialoguePlacementCliArgs(incomplete))
      .toThrow(`${flag} is required.`);
  });

  it.each(valueFlags)("requires a nonempty value for %s", (flag) => {
    for (const suffix of [[], [" "], ["--confirm-placement"]]) {
      expect(() => parseDialoguePlacementCliArgs([flag, ...suffix]))
        .toThrow(`${flag} requires a value.`);
    }
  });

  it.each(valueFlags)("rejects duplicate %s", (flag) => {
    expect(() => parseDialoguePlacementCliArgs([...args, flag, "value"]))
      .toThrow(/Duplicate dialogue placement CLI argument/);
  });

  it("rejects duplicate confirmation", () => {
    expect(() => parseDialoguePlacementCliArgs([
      ...args, "--confirm-placement", "--confirm-placement",
    ])).toThrow(/Duplicate dialogue placement CLI argument/);
  });

  it("rejects a value following confirmation", () => {
    expect(() => parseDialoguePlacementCliArgs([
      ...args, "--confirm-placement", "false",
    ])).toThrow(/Unknown dialogue placement CLI argument: false/);
  });

  it.each([
    "--unknown", "--confirm-placement=false", "--dialogue-plan-key",
    "--source-sha256", "--source-audio-path", "--source-bytes",
    "--duration-seconds", "--end-seconds", "--provider", "--audio-key",
    "--voice", "--text", "--timing-hash",
  ])("rejects unsupported flag %s", (flag) => {
    expect(() => parseDialoguePlacementCliArgs([...args, flag]))
      .toThrow(/Unknown dialogue placement CLI argument/);
  });

  it.each([
    "", " ", ",", "line=0,", ",line=0", "line=0,,other=1",
    "line", "line=0=1", " =0", "line= ", "line=abc", "line=NaN",
    "line=Infinity", "line=-0.5", "line=0,line=1", "line=0, line =1",
  ])("rejects malformed placements %j", (value) => {
    expect(() => parseDialoguePlacementCliArgs([
      ...args.slice(0, 6), "--placements", value,
    ])).toThrow();
  });

  it.each([0, 2, 4])("validates canonical ID at index %s", (index) => {
    const invalid = [...args];
    invalid[index + 1] = "../escape";
    expect(() => parseDialoguePlacementCliArgs(invalid)).toThrow();
  });

  it("leaves canonical line order and shot-duration validation to the creator", () => {
    const options = parseDialoguePlacementCliArgs([
      ...args.slice(0, 6), "--placements", "other-line=1000,first-line=0",
    ]);
    expect(options.placements.map((line) => line.startSeconds)).toEqual([1000, 0]);
  });
});
