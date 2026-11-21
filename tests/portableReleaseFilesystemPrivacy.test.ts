import {
  describe,
  expect,
  it,
} from "vitest";

import {
  enforcePortableReleasePrivateDirectoryMode,
} from "../src/deployment/portableReleaseFilesystem.js";

type FakeMetadata =
  Readonly<{
    mode: number;
    isDirectory: () => boolean;
    isSymbolicLink: () => boolean;
  }>;

function metadata(
  input: Readonly<{
    mode: number;
    directory?: boolean;
    symbolicLink?: boolean;
  }>,
): FakeMetadata {
  return Object.freeze({
    mode:
      input.mode,

    isDirectory:
      () =>
        input.directory ??
        true,

    isSymbolicLink:
      () =>
        input.symbolicLink ??
        false,
  });
}

describe(
  "portable release private staging directory",
  () => {
    it(
      "enforces mode 0700 and verifies the resulting real directory before use",
      async () => {
        const events:
          string[] =
          [];

        let reads =
          0;

        await expect(
          enforcePortableReleasePrivateDirectoryMode(
            "/opt/busybookie/.installing/revision",
            {
              readMetadata:
                async path => {
                  events.push(
                    "read:" +
                      path,
                  );

                  reads +=
                    1;

                  return metadata({
                    mode:
                      reads ===
                        1
                        ? 0o755
                        : 0o700,
                  });
                },

              writeMode:
                async (
                  path,
                  mode,
                ) => {
                  events.push(
                    "chmod:" +
                      path +
                      ":" +
                      mode.toString(
                        8,
                      ),
                  );
                },
            },
          ),
        ).resolves.toBeUndefined();

        expect(
          events,
        ).toEqual([
          "read:/opt/busybookie/.installing/revision",
          "chmod:/opt/busybookie/.installing/revision:700",
          "read:/opt/busybookie/.installing/revision",
        ]);
      },
    );

    it(
      "rejects a symbolic-link staging path before chmod",
      async () => {
        let chmodCalls =
          0;

        await expect(
          enforcePortableReleasePrivateDirectoryMode(
            "/opt/busybookie/.installing/revision",
            {
              readMetadata:
                async () =>
                  metadata({
                    mode:
                      0o777,

                    symbolicLink:
                      true,
                  }),

              writeMode:
                async () => {
                  chmodCalls +=
                    1;
                },
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Portable release private staging path must be a real directory before permission enforcement.",
        );

        expect(
          chmodCalls,
        ).toBe(
          0,
        );
      },
    );

    it(
      "fails closed when chmod cannot enforce privacy",
      async () => {
        await expect(
          enforcePortableReleasePrivateDirectoryMode(
            "/opt/busybookie/.installing/revision",
            {
              readMetadata:
                async () =>
                  metadata({
                    mode:
                      0o755,
                  }),

              writeMode:
                async () => {
                  throw new Error(
                    "synthetic-chmod-failure",
                  );
                },
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Portable release private staging directory permissions could not be enforced.",
        );
      },
    );

    it(
      "fails closed when post-chmod metadata cannot be verified",
      async () => {
        let reads =
          0;

        await expect(
          enforcePortableReleasePrivateDirectoryMode(
            "/opt/busybookie/.installing/revision",
            {
              readMetadata:
                async () => {
                  reads +=
                    1;

                  if (
                    reads ===
                      2
                  ) {
                    throw new Error(
                      "synthetic-post-chmod-stat-failure",
                    );
                  }

                  return metadata({
                    mode:
                      0o755,
                  });
                },

              writeMode:
                async () => {},
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Portable release private staging directory permissions could not be verified.",
        );
      },
    );

    it(
      "fails closed when the resulting permission bits are not exactly 0700",
      async () => {
        let reads =
          0;

        await expect(
          enforcePortableReleasePrivateDirectoryMode(
            "/opt/busybookie/.installing/revision",
            {
              readMetadata:
                async () => {
                  reads +=
                    1;

                  return metadata({
                    mode:
                      reads ===
                        1
                        ? 0o755
                        : 0o750,
                  });
                },

              writeMode:
                async () => {},
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Portable release private staging directory must be a real directory with mode 0700 before extraction.",
        );
      },
    );

    it(
      "fails closed when the post-chmod path is no longer a real directory",
      async () => {
        let reads =
          0;

        await expect(
          enforcePortableReleasePrivateDirectoryMode(
            "/opt/busybookie/.installing/revision",
            {
              readMetadata:
                async () => {
                  reads +=
                    1;

                  return metadata({
                    mode:
                      0o700,

                    directory:
                      reads ===
                        1,
                  });
                },

              writeMode:
                async () => {},
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Portable release private staging directory must be a real directory with mode 0700 before extraction.",
        );
      },
    );
  },
);
