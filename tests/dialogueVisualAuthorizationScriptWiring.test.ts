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

vi.mock("../src/dialogue/cli/runDialogueVisualAuthorizationCli.js", () => ({
  runDialogueVisualAuthorizationCli: vi.fn(async () => undefined),
}));

import {
  runDialogueVisualAuthorizationCli,
} from "../src/dialogue/cli/runDialogueVisualAuthorizationCli.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.resetModules();
});

describe("dialogue visual authorization script wiring", () => {
  it("registers the package command and invokes the production runner", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf8"));
    expect(pkg.scripts["dialogue:authorize-visual"])
      .toBe("tsx scripts/dialogue-authorize-visual.ts");

    await import("../scripts/dialogue-authorize-visual.js");

    expect(runDialogueVisualAuthorizationCli).toHaveBeenCalledExactlyOnceWith();
  });

  it.each([
    new Error("Controlled authorization failure"),
    "Controlled authorization failure",
  ])("reports runner rejection and sets exit code 1", async (failure) => {
    const previous = process.exitCode;
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(runDialogueVisualAuthorizationCli).mockRejectedValueOnce(failure);

    try {
      await import("../scripts/dialogue-authorize-visual.js");

      expect(log).toHaveBeenCalledWith("Controlled authorization failure");
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previous;
    }
  });
});
