import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pass-through spies on every write-capable fs/promises export, so the
// listing can be proven read-only against a real temporary directory.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: vi.fn(actual.writeFile),
    appendFile: vi.fn(actual.appendFile),
    mkdir: vi.fn(actual.mkdir),
    rm: vi.fn(actual.rm),
    rmdir: vi.fn(actual.rmdir),
    unlink: vi.fn(actual.unlink),
    rename: vi.fn(actual.rename),
    copyFile: vi.fn(actual.copyFile),
    symlink: vi.fn(actual.symlink),
    open: vi.fn(actual.open),
  };
});

import * as fsPromises from "node:fs/promises";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isCanonicalEpisodeId,
  listCanonicalEpisodes,
  type ListCanonicalEpisodesDependencies,
} from "../src/application/listCanonicalEpisodes.js";
import type { EpisodeManifest } from "../src/schemas/episodeManifest.schema.js";
import { loadEpisodeManifest } from "../src/validation/loadEpisodeManifest.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "busybookie-d1-episodes-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function episodeDirectories(...names: string[]) {
  for (const name of names) await mkdir(join(root, name));
}

function manifest(episodeId: string, title: string, shotsPerScene: readonly number[]): EpisodeManifest {
  return {
    episodeId,
    title,
    scenes: shotsPerScene.map((count) => ({ shots: Array.from({ length: count }, () => ({})) })),
  } as unknown as EpisodeManifest;
}

function dependencies(load?: ListCanonicalEpisodesDependencies["loadEpisodeManifest"]) {
  const loadEpisodeManifest = vi.fn(
    load ?? (async (episodeId: string) => manifest(episodeId, `Title ${episodeId}`, [2, 1])),
  );
  const deps: ListCanonicalEpisodesDependencies = {
    episodesDirectory: root,
    readDirectory: (directory) => fsPromises.readdir(directory, { withFileTypes: true }),
    loadEpisodeManifest,
  };
  return { deps, loadEpisodeManifest };
}

function writeSpies() {
  return [
    fsPromises.writeFile,
    fsPromises.appendFile,
    fsPromises.mkdir,
    fsPromises.rm,
    fsPromises.rmdir,
    fsPromises.unlink,
    fsPromises.rename,
    fsPromises.copyFile,
    fsPromises.symlink,
    fsPromises.open,
  ].map((spy) => vi.mocked(spy));
}

describe("D1 listCanonicalEpisodes", () => {
  it("lists only plain canonical episode directories, manifest-level only, in numeric then string order", async () => {
    await episodeDirectories("EP100", "EP10", "EP02", "EP002", ".hidden", "tmp", "EP02.bak", "EPX1", "EP1", "EP0001");
    await writeFile(join(root, "README.md"), "not an episode");
    const { deps, loadEpisodeManifest } = dependencies();

    const listing = await listCanonicalEpisodes(deps);

    expect(listing).toEqual([
      { episodeId: "EP002", manifest: "VALID", title: "Title EP002", sceneCount: 2, shotCount: 3 },
      { episodeId: "EP02", manifest: "VALID", title: "Title EP02", sceneCount: 2, shotCount: 3 },
      { episodeId: "EP10", manifest: "VALID", title: "Title EP10", sceneCount: 2, shotCount: 3 },
      { episodeId: "EP100", manifest: "VALID", title: "Title EP100", sceneCount: 2, shotCount: 3 },
    ]);
    expect(Object.isFrozen(listing)).toBe(true);
    expect(loadEpisodeManifest.mock.calls).toEqual([
      ["EP002", join(root, "EP002", "episode.json")],
      ["EP02", join(root, "EP02", "episode.json")],
      ["EP10", join(root, "EP10", "episode.json")],
      ["EP100", join(root, "EP100", "episode.json")],
    ]);
  });

  it("lists an episode whose manifest cannot be loaded as INVALID, without surfacing the reason", async () => {
    await episodeDirectories("EP02", "EP03");
    const { deps } = dependencies(async (episodeId) => {
      if (episodeId === "EP03") throw new Error(`Episode manifest validation failed: ${root}/EP03/episode.json`);
      return manifest(episodeId, "Valid", [1]);
    });

    const listing = await listCanonicalEpisodes(deps);

    expect(listing).toEqual([
      { episodeId: "EP02", manifest: "VALID", title: "Valid", sceneCount: 1, shotCount: 1 },
      { episodeId: "EP03", manifest: "INVALID" },
    ]);
    expect(JSON.stringify(listing)).not.toContain(root);
  });

  it("an empty root is an empty listing, but a missing root rejects", async () => {
    const { deps } = dependencies();
    await expect(listCanonicalEpisodes(deps)).resolves.toEqual([]);
    await expect(
      listCanonicalEpisodes({ ...deps, episodesDirectory: join(root, "missing") }),
    ).rejects.toThrow();
  });

  it("a case variant of a canonical ID fails the whole listing closed", async () => {
    await episodeDirectories("EP02", "ep05");
    const { deps, loadEpisodeManifest } = dependencies();
    await expect(listCanonicalEpisodes(deps)).rejects.toThrow(
      "An episode directory name differs from a canonical episode ID only by letter case.",
    );
    expect(loadEpisodeManifest).not.toHaveBeenCalled();
  });

  it("a canonical name that is a file fails the whole listing closed", async () => {
    await episodeDirectories("EP02");
    await writeFile(join(root, "EP07"), "not a directory");
    const { deps } = dependencies();
    await expect(listCanonicalEpisodes(deps)).rejects.toThrow("Canonical episode entry EP07 is not a plain directory.");
  });

  it("a linked canonical name (symlink or junction) is never followed and fails closed", async () => {
    await episodeDirectories("EP02", "target");
    await symlink(join(root, "target"), join(root, "EP08"), process.platform === "win32" ? "junction" : "dir");
    const { deps, loadEpisodeManifest } = dependencies();
    await expect(listCanonicalEpisodes(deps)).rejects.toThrow("Canonical episode entry EP08 is not a plain directory.");
    expect(loadEpisodeManifest).not.toHaveBeenCalled();
  });

  it("performs no filesystem writes", async () => {
    await episodeDirectories("EP02", "EP03", "notes");
    const { deps } = dependencies();
    for (const spy of writeSpies()) spy.mockClear();
    await listCanonicalEpisodes(deps);
    for (const spy of writeSpies()) expect(spy).not.toHaveBeenCalled();
  });

  it("uses the real manifest loader against a copy of the canonical EP02 manifest", async () => {
    const source = await readFile(new URL("../episodes/EP02/episode.json", import.meta.url), "utf8");
    await episodeDirectories("EP02");
    await writeFile(join(root, "EP02", "episode.json"), source);
    const canonical = await loadEpisodeManifest("EP02");

    const listing = await listCanonicalEpisodes({
      episodesDirectory: root,
      readDirectory: (directory) => fsPromises.readdir(directory, { withFileTypes: true }),
      loadEpisodeManifest,
    });

    expect(listing).toEqual([
      {
        episodeId: "EP02",
        manifest: "VALID",
        title: canonical.title,
        sceneCount: canonical.scenes.length,
        shotCount: canonical.scenes.reduce((total, scene) => total + scene.shots.length, 0),
      },
    ]);
  });
});

describe("D1 canonical episode-ID validation is the engine's own schema", () => {
  it.each([
    ["EP02", true],
    ["EP123", true],
    ["EP2", false],
    ["EP1234", false],
    ["ep02", false],
    ["EP02 ", false],
    ["../EP02", false],
    ["EP%30%32", false],
    [undefined, false],
    [2, false],
  ])("isCanonicalEpisodeId(%j) === %s", (value, expected) => {
    expect(isCanonicalEpisodeId(value)).toBe(expected);
  });

  it("the listing module reuses ExecutionReservationEpisodeIdSchema and declares no episode-ID regex of its own", async () => {
    const source = await readFile(new URL("../src/application/listCanonicalEpisodes.ts", import.meta.url), "utf8");
    expect(source).toContain("ExecutionReservationEpisodeIdSchema.safeParse(");
    expect(source).not.toMatch(/EP\[0-9\]|\/\^EP/);
  });
});
