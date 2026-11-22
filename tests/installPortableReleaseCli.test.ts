import {
  spawnSync,
} from "node:child_process";

import {
  readFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  resolve,
} from "node:path";

import {
  fileURLToPath,
} from "node:url";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  parseInstallPortableReleaseCliArgs,
} from "../src/deployment/cli/installPortableReleaseCliArgs.js";

import {
  formatInstallPortableReleaseCliError,
  formatInstallPortableReleaseResult,
  runInstallPortableReleaseCli,
  type RunInstallPortableReleaseCliDependencies,
} from "../src/deployment/cli/runInstallPortableReleaseCli.js";

import type {
  PortableReleaseInstallationResult,
} from "../src/deployment/installPortableRelease.js";

const REPOSITORY_ROOT =
  fileURLToPath(
    new URL(
      "..",
      import.meta.url,
    ),
  );

const REVISION =
  "0ff4981807eb8db6a0aac73fefbd94292d7d12ef";

const ARCHIVE_SHA =
  "a".repeat(
    64,
  );

const TREE_SHA =
  "b".repeat(
    64,
  );

const CWD =
  resolve(
    tmpdir(),
    "busybookie-install-cli-cwd",
  );

const ABSOLUTE_ARCHIVE =
  resolve(
    tmpdir(),
    "artifacts",
    "busybookie-release.tar.gz",
  );

function validArgs(): string[] {
  return [
    "--archive",
    ABSOLUTE_ARCHIVE,
    "--tree-manifest",
    "artifacts/busybookie-release-tree.sha256",
    "--expected-archive-sha256",
    ARCHIVE_SHA,
    "--expected-tree-manifest-sha256",
    TREE_SHA,
    "--reviewed-revision",
    REVISION,
    "--releases-root",
    "deploy/releases",
    "--staging-root",
    "deploy/.installing",
  ];
}

function installationResult(): PortableReleaseInstallationResult {
  return Object.freeze({
    reviewedRevision:
      REVISION,

    releaseRoot:
      resolve(
        CWD,
        "deploy",
        "releases",
        REVISION,
        "app",
      ),

    receiptPath:
      resolve(
        CWD,
        "deploy",
        "releases",
        ".receipts",
        `${REVISION}.json`,
      ),

    archiveSha256:
      ARCHIVE_SHA,

    treeManifestSha256:
      TREE_SHA,

    identityManifestSha256:
      "c".repeat(
        64,
      ),

    installedFileCount:
      5,

    dependencyManifestSha256:
      "d".repeat(
        64,
      ),

    dependencyFileCount:
      4,

    dependencyTotalBytes:
      321,
  });
}

function harness(
  install: RunInstallPortableReleaseCliDependencies["install"],
): Readonly<{
  dependencies: RunInstallPortableReleaseCliDependencies;
  stdout: string[];
}> {
  const stdout:
    string[] =
      [];

  return Object.freeze({
    stdout,

    dependencies:
      Object.freeze({
        install,

        currentDirectory:
          () =>
            CWD,

        writeStdout:
          (
            text: string,
          ) => {
            stdout.push(
              text,
            );
          },
      }),
  });
}

describe(
  "portable release install CLI adapter",
  () => {
    it(
      "calls installPortableRelease exactly once with exactly the mapped installer inputs and emits its result as JSON",
      async () => {
        const calls:
          unknown[][] =
            [];

        const result =
          installationResult();

        const current =
          harness(
            async (
              ...args
            ) => {
              calls.push(
                args,
              );

              return result;
            },
          );

        await runInstallPortableReleaseCli(
          validArgs(),
          current.dependencies,
        );

        expect(
          calls,
        ).toEqual([
          [
            {
              archivePath:
                ABSOLUTE_ARCHIVE,

              treeManifestPath:
                resolve(
                  CWD,
                  "artifacts/busybookie-release-tree.sha256",
                ),

              expectedArchiveSha256:
                ARCHIVE_SHA,

              expectedTreeManifestSha256:
                TREE_SHA,

              expectedReviewedRevision:
                REVISION,

              releasesRoot:
                resolve(
                  CWD,
                  "deploy/releases",
                ),

              stagingRoot:
                resolve(
                  CWD,
                  "deploy/.installing",
                ),
            },
          ],
        ]);

        expect(
          current.stdout,
        ).toEqual([
          `${JSON.stringify(
            result,
            null,
            2,
          )}\n`,
        ]);
      },
    );

    it(
      "surfaces a replayed result unchanged, with no added fields or semantics",
      async () => {
        const result =
          installationResult();

        const current =
          harness(
            async () =>
              result,
          );

        await runInstallPortableReleaseCli(
          validArgs(),
          current.dependencies,
        );

        await runInstallPortableReleaseCli(
          validArgs(),
          current.dependencies,
        );

        expect(
          current.stdout[0],
        ).toBe(
          current.stdout[1],
        );

        expect(
          JSON.parse(
            current.stdout[0] ??
              "",
          ),
        ).toEqual(
          result,
        );

        expect(
          formatInstallPortableReleaseResult(
            result,
          ),
        ).toBe(
          current.stdout[0],
        );
      },
    );

    it.each([
      "--archive",
      "--tree-manifest",
      "--expected-archive-sha256",
      "--expected-tree-manifest-sha256",
      "--reviewed-revision",
      "--releases-root",
      "--staging-root",
    ])(
      "fails before the installer when %s is missing",
      async flag => {
        const args =
          validArgs();

        const index =
          args.indexOf(
            flag,
          );

        args.splice(
          index,
          2,
        );

        let installs =
          0;

        const current =
          harness(
            async () => {
              installs +=
                1;

              return installationResult();
            },
          );

        await expect(
          runInstallPortableReleaseCli(
            args,
            current.dependencies,
          ),
        ).rejects.toThrow(
          `${flag} is required.`,
        );

        expect(
          installs,
        ).toBe(
          0,
        );

        expect(
          current.stdout,
        ).toEqual(
          [],
        );
      },
    );

    it.each([
      [
        "--reviewed-revision",
        REVISION.toUpperCase(),
        "--reviewed-revision must be exactly 40 lowercase hexadecimal characters.",
      ],
      [
        "--reviewed-revision",
        REVISION.slice(
          1,
        ),
        "--reviewed-revision must be exactly 40 lowercase hexadecimal characters.",
      ],
      [
        "--expected-archive-sha256",
        "g".repeat(
          64,
        ),
        "--expected-archive-sha256 must be exactly 64 lowercase hexadecimal characters.",
      ],
      [
        "--expected-tree-manifest-sha256",
        TREE_SHA.slice(
          1,
        ),
        "--expected-tree-manifest-sha256 must be exactly 64 lowercase hexadecimal characters.",
      ],
    ])(
      "fails before the installer when %s is malformed (%s)",
      async (
        flag,
        value,
        message,
      ) => {
        const args =
          validArgs();

        args[
          args.indexOf(
            flag,
          ) + 1
        ] =
          value;

        let installs =
          0;

        const current =
          harness(
            async () => {
              installs +=
                1;

              return installationResult();
            },
          );

        await expect(
          runInstallPortableReleaseCli(
            args,
            current.dependencies,
          ),
        ).rejects.toThrow(
          message,
        );

        expect(
          installs,
        ).toBe(
          0,
        );
      },
    );

    it.each([
      [
        "a duplicate flag",
        [
          ...validArgs(),
          "--staging-root",
          "other",
        ],
        "Duplicate portable release install argument: --staging-root",
      ],
      [
        "an unknown flag without echoing its value",
        [
          ...validArgs(),
          "--force=secret-value",
        ],
        "Unknown portable release install argument: --force",
      ],
      [
        "a positional argument",
        [
          ...validArgs(),
          "extra",
        ],
        "Unexpected positional portable release install argument.",
      ],
      [
        "a flag whose value is missing",
        [
          ...validArgs().slice(
            2,
          ),
          "--archive",
        ],
        "--archive requires a value.",
      ],
      [
        "a flag whose value looks like another flag",
        [
          "--archive",
          "--tree-manifest",
          ...validArgs().slice(
            2,
          ),
        ],
        "--archive requires a value.",
      ],
      [
        "an empty path value",
        [
          ...validArgs().slice(
            2,
          ),
          "--archive",
          "",
        ],
        "--archive requires a value.",
      ],
    ])(
      "rejects %s before the installer",
      async (
        _label,
        args,
        message,
      ) => {
        let installs =
          0;

        const current =
          harness(
            async () => {
              installs +=
                1;

              return installationResult();
            },
          );

        await expect(
          runInstallPortableReleaseCli(
            args,
            current.dependencies,
          ),
        ).rejects.toThrow(
          message,
        );

        expect(
          installs,
        ).toBe(
          0,
        );

        expect(
          message,
        ).not.toContain(
          "secret-value",
        );
      },
    );

    it(
      "propagates the installer rejection itself, writes no result, and renders the installer message verbatim",
      async () => {
        const failure =
          new Error(
            "Portable release installation failed: Existing immutable release receipt does not match the requested release authorities.",
          );

        const current =
          harness(
            async () => {
              throw failure;
            },
          );

        let observed:
          unknown =
            null;

        try {
          await runInstallPortableReleaseCli(
            validArgs(),
            current.dependencies,
          );
        } catch (cause) {
          observed =
            cause;
        }

        expect(
          observed,
        ).toBe(
          failure,
        );

        expect(
          current.stdout,
        ).toEqual(
          [],
        );

        expect(
          formatInstallPortableReleaseCliError(
            observed,
          ),
        ).toBe(
          "Portable release installation failed: Existing immutable release receipt does not match the requested release authorities.\n",
        );
      },
    );

    it(
      "propagates the receipt-only unsafe state as the installer failure, unchanged",
      async () => {
        const failure =
          new Error(
            "Portable release installation failed: Committed install receipt exists but its immutable release directory is missing; automatic recovery is unsafe and operator intervention is required.",
          );

        const current =
          harness(
            async () => {
              throw failure;
            },
          );

        await expect(
          runInstallPortableReleaseCli(
            validArgs(),
            current.dependencies,
          ),
        ).rejects.toBe(
          failure,
        );

        expect(
          formatInstallPortableReleaseCliError(
            failure,
          ),
        ).toBe(
          `${failure.message}\n`,
        );
      },
    );

    it(
      "prefixes non-installer errors, keeps only a bounded first line and never renders a stack",
      () => {
        expect(
          formatInstallPortableReleaseCliError(
            new Error(
              "--archive is required.",
            ),
          ),
        ).toBe(
          "Portable release installation failed: --archive is required.\n",
        );

        const multiline =
          new Error(
            "first line\nsecond line with detail",
          );

        expect(
          formatInstallPortableReleaseCliError(
            multiline,
          ),
        ).toBe(
          "Portable release installation failed: first line\n",
        );

        const long =
          formatInstallPortableReleaseCliError(
            new Error(
              "x".repeat(
                900,
              ),
            ),
          );

        expect(
          long.length,
        ).toBeLessThan(
          600,
        );

        expect(
          long.endsWith(
            "...\n",
          ),
        ).toBe(
          true,
        );

        expect(
          formatInstallPortableReleaseCliError(
            "not an error",
          ),
        ).toBe(
          "Portable release installation failed: non-error failure value.\n",
        );
      },
    );

    it(
      "parses without touching the filesystem and resolves relative paths against the supplied directory",
      () => {
        const options =
          parseInstallPortableReleaseCliArgs(
            validArgs(),
            CWD,
          );

        expect(
          Object.keys(
            options,
          ).sort(),
        ).toEqual([
          "archivePath",
          "expectedArchiveSha256",
          "expectedReviewedRevision",
          "expectedTreeManifestSha256",
          "releasesRoot",
          "stagingRoot",
          "treeManifestPath",
        ]);

        expect(
          options.archivePath,
        ).toBe(
          ABSOLUTE_ARCHIVE,
        );

        expect(
          options.releasesRoot,
        ).toBe(
          resolve(
            CWD,
            "deploy/releases",
          ),
        );

        expect(
          Object.isFrozen(
            options,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "keeps the adapter free of npm, dependency preparation, receipt, quarantine, process-spawning and network paths",
      async () => {
        const sources =
          await Promise.all(
            [
              "src/deployment/cli/installPortableReleaseCliArgs.ts",
              "src/deployment/cli/runInstallPortableReleaseCli.ts",
              "src/deployment/installPortableReleaseProcess.ts",
              "scripts/install-portable-release.ts",
            ].map(
              async path =>
                [
                  path,
                  await readFile(
                    resolve(
                      REPOSITORY_ROOT,
                      path,
                    ),
                    "utf8",
                  ),
                ] as const,
            ),
          );

        for (
          const [
            path,
            source,
          ]
          of sources
        ) {
          for (
            const forbidden
            of [
              "preparePortableReleaseProductionDependencies",
              "runInstall:",
              "runInstall,",
              "collectInstallProvenance",
              "writePortableReleaseInstallReceipt",
              "readExactPortableReleaseInstallReceiptReplay",
              "quarantinePortableRelease",
              "publishPortableReleaseAtomically",
              "execFile",
              "spawn",
              "fetch(",
              "http",
              "GEMINI",
              "RUNWAY",
            ]
          ) {
            expect(
              `${path}: ${source.includes(forbidden) ? forbidden : "clean"}`,
            ).toBe(
              `${path}: clean`,
            );
          }
        }

        const importSpecifiers =
          sources.flatMap(
            ([
              ,
              source,
            ]) =>
              [
                ...source.matchAll(
                  /from "([^"]+)"/gu,
                ),
              ].map(
                match =>
                  match[1],
              ),
          );

        expect(
          [
            ...new Set(
              importSpecifiers,
            ),
          ].sort(),
        ).toEqual([
          "../installPortableRelease.js",
          "../portableReleaseInstallContract.js",
          "../src/deployment/cli/runInstallPortableReleaseCli.js",
          "./cli/runInstallPortableReleaseCli.js",
          "./installPortableReleaseCliArgs.js",
          "node:path",
        ]);
      },
    );

    it(
      "exits non-zero with the rendered error and no stdout when run as a real process with invalid input",
      () => {
        const run =
          (
            args: readonly string[],
          ) =>
            spawnSync(
              process.execPath,
              [
                "--import",
                "tsx",
                "scripts/install-portable-release.ts",
                ...args,
              ],
              {
                cwd:
                  REPOSITORY_ROOT,

                encoding:
                  "utf8",

                timeout:
                  60_000,

                env: {
                  ...process.env,

                  RUNWAYML_API_SECRET:
                    "",

                  GEMINI_API_KEY:
                    "",

                  BUSYBOOKIE_FFMPEG_PATH:
                    "",

                  BUSYBOOKIE_FFPROBE_PATH:
                    "",
                },
              },
            );

        const missing =
          run(
            [],
          );

        expect(
          missing.status,
        ).toBe(
          1,
        );

        expect(
          missing.stdout,
        ).toBe(
          "",
        );

        expect(
          missing.stderr,
        ).toBe(
          "Portable release installation failed: --archive is required.\n",
        );

        const args =
          validArgs();

        args[
          args.indexOf(
            "--reviewed-revision",
          ) + 1
        ] =
          "not-a-revision";

        const malformed =
          run(
            args,
          );

        expect(
          malformed.status,
        ).toBe(
          1,
        );

        expect(
          malformed.stdout,
        ).toBe(
          "",
        );

        expect(
          malformed.stderr,
        ).toBe(
          "Portable release installation failed: --reviewed-revision must be exactly 40 lowercase hexadecimal characters.\n",
        );
      },
      90_000,
    );
  },
);
