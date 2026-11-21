import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";

import {
  posix,
} from "node:path";

import {
  portableReleaseInstallFailure as fail,
  requirePortableReleaseRevision as requireRevision,
} from "./portableReleaseInstallContract.js";

const INSTALL_LOCK_DIRECTORY =
  ".install-locks";

export type PortableReleaseRevisionLockLease =
  Readonly<{
    release: () => Promise<void>;
  }>;

export type PortableReleaseRevisionLockAcquirer =
  (
    input: Readonly<{
      releasesRoot: string;
      reviewedRevision: string;
    }>,
  ) => Promise<PortableReleaseRevisionLockLease>;

export type PortableReleaseFlockProcessLease =
  Readonly<{
    release: () => Promise<void>;
  }>;

export type PortableReleaseFlockProcessSpawner =
  (
    command: string,
    args: readonly string[],
    options: Readonly<{
      stdio: readonly [
        "pipe",
        "pipe",
        "pipe",
      ];
      windowsHide: true;
    }>,
  ) => ChildProcessWithoutNullStreams;

export type PortableReleaseFlockProcessDependencies =
  Readonly<{
    spawn: PortableReleaseFlockProcessSpawner;
  }>;

export type PortableReleaseFlockDependencies =
  Readonly<{
    platform: string;
    ensureLockDirectory: (
      path: string,
    ) => Promise<void>;
    spawnLockProcess: (
      input: Readonly<{
        command: string;
        args: readonly string[];
      }>,
    ) => Promise<PortableReleaseFlockProcessLease>;
  }>;

const FLOCK_READY_TOKEN =
  "BUSYBOOKIE_FLOCK_READY\n";

const FLOCK_READINESS_TIMEOUT_MS =
  35_000;

const MAX_FLOCK_DIAGNOSTIC_BYTES =
  64 * 1024;

function appendBoundedDiagnostic(
  current: string,
  chunk: string,
): string {
  const combined =
    current +
    chunk;

  if (
    Buffer.byteLength(
      combined,
      "utf8",
    ) <=
      MAX_FLOCK_DIAGNOSTIC_BYTES
  ) {
    return combined;
  }

  return Buffer.from(
    combined,
    "utf8",
  )
    .subarray(
      0,
      MAX_FLOCK_DIAGNOSTIC_BYTES,
    )
    .toString(
      "utf8",
    );
}

function formatFlockProcessFailure(
  message: string,
  stderr: string,
  stdout: string,
): string {
  const diagnostics:
    string[] =
      [];

  if (
    stderr.length >
      0
  ) {
    diagnostics.push(
      `stderr=${JSON.stringify(stderr)}`,
    );
  }

  if (
    stdout.length >
      0
  ) {
    diagnostics.push(
      `stdout=${JSON.stringify(stdout)}`,
    );
  }

  if (
    diagnostics.length ===
      0
  ) {
    return message;
  }

  return (
    message +
    " (" +
    diagnostics.join(
      ", ",
    ) +
    ")"
  );
}

export async function spawnPortableReleaseFlockProcess(
  input: Readonly<{
    command: string;
    args: readonly string[];
  }>,
  dependencies:
    PortableReleaseFlockProcessDependencies =
      {
        spawn:
          spawn as PortableReleaseFlockProcessSpawner,
      },
): Promise<PortableReleaseFlockProcessLease> {
  const child =
    dependencies.spawn(
      input.command,
      [
        ...input.args,
      ],
      {
        stdio:
          [
            "pipe",
            "pipe",
            "pipe",
          ],
        windowsHide:
          true,
      },
    );

  child.stdout.setEncoding(
    "utf8",
  );

  child.stderr.setEncoding(
    "utf8",
  );

  let stdout =
    "";

  let stderr =
    "";

  child.stdout.on(
    "data",
    chunk => {
      stdout =
        appendBoundedDiagnostic(
          stdout,
          String(
            chunk,
          ),
        );
    },
  );

  child.stderr.on(
    "data",
    chunk => {
      stderr =
        appendBoundedDiagnostic(
          stderr,
          String(
            chunk,
          ),
        );
    },
  );

  await new Promise<void>(
    (
      resolveReady,
      rejectReady,
    ) => {
      let settled =
        false;

      let readinessTimeout:
        ReturnType<typeof setTimeout> |
        null =
          null;

      const clearReadinessTimeout =
        () => {
          if (
            readinessTimeout ===
              null
          ) {
            return;
          }

          clearTimeout(
            readinessTimeout,
          );

          readinessTimeout =
            null;
        };

      const settleFailure =
        (
          error:
            Error,
        ) => {
          if (settled) {
            return;
          }

          settled =
            true;

          clearReadinessTimeout();

          rejectReady(
            error,
          );
        };

      const settleFailureAfterChildExit =
        (
          error:
            Error,
        ) => {
          if (settled) {
            return;
          }

          settled =
            true;

          clearReadinessTimeout();

          const rejectAfterChildTermination =
            () => {
              child.removeListener(
                "exit",
                rejectAfterChildTermination,
              );

              child.removeListener(
                "error",
                rejectAfterChildTermination,
              );

              rejectReady(
                error,
              );
            };

          if (
            child.exitCode !==
              null ||
            child.signalCode !==
              null
          ) {
            rejectAfterChildTermination();
            return;
          }

          child.once(
            "exit",
            rejectAfterChildTermination,
          );

          child.once(
            "error",
            rejectAfterChildTermination,
          );

          child.stdin.end();
        };

      const maybeReady =
        () => {
          if (settled) {
            return;
          }

          if (
            stdout ===
              FLOCK_READY_TOKEN
          ) {
            settled =
              true;

            clearReadinessTimeout();

            resolveReady();
            return;
          }

          if (
            stdout.length >=
              FLOCK_READY_TOKEN.length &&
            stdout !==
              FLOCK_READY_TOKEN
          ) {
            settleFailureAfterChildExit(
              fail(
                formatFlockProcessFailure(
                  "Linux flock readiness output was invalid.",
                  stderr,
                  stdout,
                ),
              ),
            );
          }
        };

      child.stdout.on(
        "data",
        maybeReady,
      );

      child.once(
        "error",
        cause => {
          const causeMessage =
            cause instanceof Error
              ? cause.message
              : String(
                  cause,
                );

          settleFailure(
            fail(
              `Linux flock process failed before readiness: ${causeMessage}`,
              {
                cause,
              },
            ),
          );
        },
      );

      child.once(
        "exit",
        (
          code,
          signal,
        ) => {
          if (settled) {
            return;
          }

          settleFailure(
            fail(
              formatFlockProcessFailure(
                `Linux flock process exited before readiness with code ${String(code)} and signal ${String(signal)}.`,
                stderr,
                stdout,
              ),
            ),
          );
        },
      );

      if (!settled) {
        readinessTimeout =
          setTimeout(
            () => {
              settleFailureAfterChildExit(
                fail(
                  `Linux flock readiness timed out after ${FLOCK_READINESS_TIMEOUT_MS}ms.`,
                ),
              );
            },
            FLOCK_READINESS_TIMEOUT_MS,
          );
      }
    },
  );

  let released =
    false;

  let releaseInFlight:
    Promise<void> |
    null =
      null;

  const waitForExit =
    (): Promise<void> =>
      new Promise(
        (
          resolveExit,
          rejectExit,
        ) => {
          if (
            child.exitCode !==
              null ||
            child.signalCode !==
              null
          ) {
            if (
              child.exitCode ===
                0 &&
              child.signalCode ===
                null
            ) {
              resolveExit();
              return;
            }

            rejectExit(
              fail(
                formatFlockProcessFailure(
                  `Linux flock process exited during release with code ${String(child.exitCode)} and signal ${String(child.signalCode)}.`,
                  stderr,
                  stdout,
                ),
              ),
            );

            return;
          }

          child.once(
            "error",
            cause => {
              rejectExit(
                fail(
                  "Linux flock process failed during release.",
                  {
                    cause,
                  },
                ),
              );
            },
          );

          child.once(
            "exit",
            (
              code,
              signal,
            ) => {
              if (
                code ===
                  0 &&
                signal ===
                  null
              ) {
                resolveExit();
                return;
              }

              rejectExit(
                fail(
                  formatFlockProcessFailure(
                    `Linux flock process exited during release with code ${String(code)} and signal ${String(signal)}.`,
                    stderr,
                    stdout,
                  ),
                ),
              );
            },
          );
        },
      );

  return Object.freeze({
    release:
      async () => {
        if (released) {
          return;
        }

        if (
          releaseInFlight !==
            null
        ) {
          await releaseInFlight;
          return;
        }

        const currentRelease =
          (
            async () => {
              const exitPromise =
                waitForExit();

              child.stdin.end();

              await exitPromise;

              released =
                true;
            }
          )();

        releaseInFlight =
          currentRelease;

        try {
          await currentRelease;
        } finally {
          if (!released) {
            releaseInFlight =
              null;
          }
        }
      },
  });
}

export async function acquirePortableReleaseFlockRevisionLock(
  input: Readonly<{
    releasesRoot: string;
    reviewedRevision: string;
  }>,
  dependencies: PortableReleaseFlockDependencies,
): Promise<PortableReleaseRevisionLockLease> {
  if (
    dependencies.platform !==
      "linux"
  ) {
    throw fail(
      "Linux is required for the portable release flock revision lock.",
    );
  }

  const reviewedRevision =
    requireRevision(
      input.reviewedRevision,
    );

  if (
    !posix.isAbsolute(
      input.releasesRoot,
    )
  ) {
    throw fail(
      "Linux releases root must be an absolute POSIX path.",
    );
  }

  const releasesRoot =
    posix.resolve(
      input.releasesRoot,
    );

  const lockRoot =
    posix.join(
      releasesRoot,
      INSTALL_LOCK_DIRECTORY,
    );

  const lockPath =
    posix.join(
      lockRoot,
      `${reviewedRevision}.lock`,
    );

  try {
    await dependencies.ensureLockDirectory(
      lockRoot,
    );
  } catch (cause) {
    throw fail(
      "Could not prepare the Linux flock lock directory.",
      {
        cause,
      },
    );
  }

  let processLease:
    PortableReleaseFlockProcessLease;

  try {
    processLease =
      await dependencies.spawnLockProcess({
        command:
          "flock",

        args:
          Object.freeze([
            "--exclusive",
            "--wait",
            "30",
            lockPath,
            "sh",
            "-c",
            'printf "BUSYBOOKIE_FLOCK_READY\\n"; exec cat >/dev/null',
          ]),
      });
  } catch (cause) {
    throw fail(
      "Could not acquire the Linux flock reviewed-revision lock.",
      {
        cause,
      },
    );
  }

  let released =
    false;

  let releaseInFlight:
    Promise<void> |
    null =
      null;

  return Object.freeze({
    release:
      async () => {
        if (released) {
          return;
        }

        if (
          releaseInFlight !==
            null
        ) {
          await releaseInFlight;
          return;
        }

        const currentRelease =
          (
            async () => {
              await processLease.release();

              released =
                true;
            }
          )();

        releaseInFlight =
          currentRelease;

        try {
          await currentRelease;
        } finally {
          if (!released) {
            releaseInFlight =
              null;
          }
        }
      },
  });
}
