import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  acquirePortableReleaseFlockRevisionLock,
} from "../src/deployment/portableReleaseFlockRevisionLock.js";

const REVISION =
  "0ff4981807eb8db6a0aac73fefbd94292d7d12ef";

describe(
  "portable release flock revision lock",
  () => {
    it(
      "launches flock for the exact reviewed-revision lock path and returns a releasable lease",
      async () => {
        const releaseProcess =
          vi.fn<
            () => Promise<void>
          >(
            async () => {},
          );

        const spawnLockProcess =
          vi.fn(
            async (
              input: Readonly<{
                command: string;
                args: readonly string[];
              }>,
            ) => {
              expect(
                input.command,
              ).toBe(
                "flock",
              );

              expect(
                input.args,
              ).toEqual([
                "--exclusive",
                "--wait",
                "30",
                "/tmp/releases/.install-locks/" +
                  REVISION +
                  ".lock",
                "sh",
                "-c",
                'printf "BUSYBOOKIE_FLOCK_READY\\n"; exec cat >/dev/null',
              ]);

              return Object.freeze({
                release:
                  releaseProcess,
              });
            },
          );

        const lease =
          await acquirePortableReleaseFlockRevisionLock(
            {
              releasesRoot:
                "/tmp/releases",

              reviewedRevision:
                REVISION,
            },
            {
              platform:
                "linux",

              ensureLockDirectory:
                async () => {},

              spawnLockProcess,
            },
          );

        expect(
          spawnLockProcess,
        ).toHaveBeenCalledTimes(
          1,
        );

        await lease.release();

        expect(
          releaseProcess,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "prepares the persistent lock directory before spawning flock",
      async () => {
        const events:
          string[] =
            [];

        const ensureLockDirectory =
          async (
            path: string,
          ): Promise<void> => {
            events.push(
              "mkdir:" +
                path,
            );
          };

        const spawnLockProcess =
          async (
            input: Readonly<{
              command: string;
              args: readonly string[];
            }>,
          ) => {
            events.push(
              "spawn:" +
                input.command,
            );

            return Object.freeze({
              release:
                async () => {},
            });
          };

        const lease =
          await acquirePortableReleaseFlockRevisionLock(
            {
              releasesRoot:
                "/tmp/releases",

              reviewedRevision:
                REVISION,
            },
            {
              platform:
                "linux",

              ensureLockDirectory,

              spawnLockProcess,
            },
          );

        expect(
          events,
        ).toEqual([
          "mkdir:/tmp/releases/.install-locks",
          "spawn:flock",
        ]);

        await lease.release();
      },
    );

    it(
      "rejects non-linux production use instead of silently falling back",
      async () => {
        await expect(
          acquirePortableReleaseFlockRevisionLock(
            {
              releasesRoot:
                "C:\\releases",

              reviewedRevision:
                REVISION,
            },
            {
              platform:
                "win32",

              ensureLockDirectory:
                async () => {
                  throw new Error(
                    "must-not-run",
                  );
                },

              spawnLockProcess:
                async () => {
                  throw new Error(
                    "must-not-run",
                  );
                },
            },
          ),
        ).rejects.toThrow(
          /Linux/u,
        );
      },
    );

    it(
      "fails closed when flock cannot be launched or acquired",
      async () => {
        await expect(
          acquirePortableReleaseFlockRevisionLock(
            {
              releasesRoot:
                "/tmp/releases",

              reviewedRevision:
                REVISION,
            },
            {
              platform:
                "linux",

              ensureLockDirectory:
                async () => {},

              spawnLockProcess:
                async () => {
                  throw new Error(
                    "flock-launch-failure",
                  );
                },
            },
          ),
        ).rejects.toThrow(
          /flock/u,
        );
      },
    );

    it(
      "makes lease release idempotent",
      async () => {
        const releaseProcess =
          vi.fn<
            () => Promise<void>
          >(
            async () => {},
          );

        const lease =
          await acquirePortableReleaseFlockRevisionLock(
            {
              releasesRoot:
                "/tmp/releases",

              reviewedRevision:
                REVISION,
            },
            {
              platform:
                "linux",

              ensureLockDirectory:
                async () => {},

              spawnLockProcess:
                async () =>
                  Object.freeze({
                    release:
                      releaseProcess,
                  }),
            },
          );

        await lease.release();
        await lease.release();

        expect(
          releaseProcess,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "propagates release failure rather than pretending the lease was released",
      async () => {
        const lease =
          await acquirePortableReleaseFlockRevisionLock(
            {
              releasesRoot:
                "/tmp/releases",

              reviewedRevision:
                REVISION,
            },
            {
              platform:
                "linux",

              ensureLockDirectory:
                async () => {},

              spawnLockProcess:
                async () =>
                  Object.freeze({
                    release:
                      async () => {
                        throw new Error(
                          "release-failure",
                        );
                      },
                  }),
            },
          );

        await expect(
          lease.release(),
        ).rejects.toThrow(
          "release-failure",
        );
      },
    );
  },
);
