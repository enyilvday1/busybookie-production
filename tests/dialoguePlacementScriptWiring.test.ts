import {
  readFile,
} from "node:fs/promises";

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("../src/dialogue/cli/runDialoguePlacementCli.js", () => ({
  runDialoguePlacementCli: vi.fn(async () => undefined),
}));

import {
  runDialoguePlacementCli,
} from "../src/dialogue/cli/runDialoguePlacementCli.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.resetModules();
});

describe("dialogue placement script wiring", () => {
  it("registers the package command and invokes the production runner", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf8"));
    expect(pkg.scripts["dialogue:place"])
      .toBe("tsx scripts/dialogue-place.ts");

    await import("../scripts/dialogue-place.js");

    expect(runDialoguePlacementCli).toHaveBeenCalledExactlyOnceWith();
  });

  it.each([
    new Error("Controlled placement failure"),
    "Controlled placement failure",
  ])("reports runner rejection and sets exit code 1", async (failure) => {
    const previous = process.exitCode;
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(runDialoguePlacementCli).mockRejectedValueOnce(failure);

    try {
      await import("../scripts/dialogue-place.js");

      expect(log).toHaveBeenCalledWith("Controlled placement failure");
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previous;
    }
  });
});
