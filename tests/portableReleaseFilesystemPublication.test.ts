import {
  describe,
  expect,
  it,
} from "vitest";

import {
  publishPortableReleaseAtomically,
  requirePortableReleaseSameFilesystem,
} from "../src/deployment/portableReleaseFilesystem.js";

describe(
  "portable release filesystem publication",
  () => {
    it(
      "accepts publication roots on the same filesystem device",
      async () => {
        const observed:
          string[] =
          [];

        await expect(
          requirePortableReleaseSameFilesystem(
            {
              releasesRoot:
                "/opt/busybookie/releases",

              stagingReleaseRoot:
                "/opt/busybookie/.installing/revision",
            },
            {
              readDevice:
                async path => {
                  observed.push(
                    path,
                  );

                  return 42;
                },
            },
          ),
        ).resolves.toBeUndefined();

        expect(
          observed,
        ).toEqual([
          "/opt/busybookie/releases",
          "/opt/busybookie/.installing/revision",
        ]);
      },
    );

    it(
      "fails closed when staging and releases are on different filesystem devices",
      async () => {
        await expect(
          requirePortableReleaseSameFilesystem(
            {
              releasesRoot:
                "/opt/busybookie/releases",

              stagingReleaseRoot:
                "/mnt/other/revision",
            },
            {
              readDevice:
                async path =>
                  path.includes(
                    "/mnt/other/",
                  )
                    ? 99
                    : 42,
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Portable release staging and releases roots must be on the same filesystem for atomic publication.",
        );
      },
    );

    it(
      "fails closed when filesystem identity cannot be established",
      async () => {
        await expect(
          requirePortableReleaseSameFilesystem(
            {
              releasesRoot:
                "/opt/busybookie/releases",

              stagingReleaseRoot:
                "/opt/busybookie/.installing/revision",
            },
            {
              readDevice:
                async () => {
                  throw new Error(
                    "synthetic-stat-failure",
                  );
                },
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Portable release publication filesystem identity could not be established.",
        );
      },
    );

    it(
      "publishes with one atomic rename",
      async () => {
        const observed:
          Array<
            readonly [
              string,
              string,
            ]
          > =
          [];

        await expect(
          publishPortableReleaseAtomically(
            {
              stagingReleaseRoot:
                "/opt/busybookie/.installing/revision",

              finalReleaseRoot:
                "/opt/busybookie/releases/revision",
            },
            {
              renameRelease:
                async (
                  source,
                  destination,
                ) => {
                  observed.push([
                    source,
                    destination,
                  ]);
                },
            },
          ),
        ).resolves.toBeUndefined();

        expect(
          observed,
        ).toEqual([
          [
            "/opt/busybookie/.installing/revision",
            "/opt/busybookie/releases/revision",
          ],
        ]);
      },
    );

    it(
      "translates EXDEV into an explicit atomic-publication failure",
      async () => {
        const crossDevice =
          Object.assign(
            new Error(
              "cross-device link not permitted",
            ),
            {
              code:
                "EXDEV",
            },
          );

        await expect(
          publishPortableReleaseAtomically(
            {
              stagingReleaseRoot:
                "/mnt/other/revision",

              finalReleaseRoot:
                "/opt/busybookie/releases/revision",
            },
            {
              renameRelease:
                async () => {
                  throw crossDevice;
                },
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Portable release publication crossed filesystem devices; atomic rename is required.",
        );
      },
    );

    it(
      "preserves non-EXDEV rename failures",
      async () => {
        const failure =
          Object.assign(
            new Error(
              "synthetic-permission-failure",
            ),
            {
              code:
                "EACCES",
            },
          );

        let observed:
          unknown;

        try {
          await publishPortableReleaseAtomically(
            {
              stagingReleaseRoot:
                "/opt/busybookie/.installing/revision",

              finalReleaseRoot:
                "/opt/busybookie/releases/revision",
            },
            {
              renameRelease:
                async () => {
                  throw failure;
                },
            },
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
      },
    );
  },
);
