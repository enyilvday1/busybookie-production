import {
  EventEmitter,
} from "node:events";

import {
  PassThrough,
} from "node:stream";

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  spawnPortableReleaseFlockProcess,
} from "../src/deployment/portableReleaseFlockRevisionLock.js";

type FakeChild =
  EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
  };

function fakeChild(): FakeChild {
  const child =
    new EventEmitter() as EventEmitter & {
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
    };

  child.stdin =
    new PassThrough();

  child.stdout =
    new PassThrough();

  child.stderr =
    new PassThrough();

  child.exitCode =
    null;

  child.signalCode =
    null;

  return child;
}

describe(
  "portable release flock subprocess runner",
  () => {
    const input =
      Object.freeze({
        command:
          "flock",

        args:
          Object.freeze([
            "--exclusive",
            "--wait",
            "30",
            "/tmp/releases/.install-locks/revision.lock",
            "sh",
            "-c",
            'printf "BUSYBOOKIE_FLOCK_READY\\n"; exec cat >/dev/null',
          ]),
      });

    it(
      "spawns the exact command with piped stdin, stdout, and stderr",
      async () => {
        const child =
          fakeChild();

        const spawn =
          vi.fn(
            () =>
              child,
          );

        const promise =
          spawnPortableReleaseFlockProcess(
            input,
            {
              spawn:
                spawn as never,
            },
          );

        expect(
          spawn,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          spawn,
        ).toHaveBeenCalledWith(
          "flock",
          [
            "--exclusive",
            "--wait",
            "30",
            "/tmp/releases/.install-locks/revision.lock",
            "sh",
            "-c",
            'printf "BUSYBOOKIE_FLOCK_READY\\n"; exec cat >/dev/null',
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

        child.stdout.write(
          "BUSYBOOKIE_FLOCK_READY\n",
        );

        const lease =
          await promise;

        expect(
          lease,
        ).toBeDefined();

        const release =
          lease.release();

        child.exitCode =
          0;

        child.emit(
          "exit",
          0,
          null,
        );

        await release;
      },
    );

    it(
      "does not resolve acquisition merely because the child process spawned",
      async () => {
        const child =
          fakeChild();

        let resolved =
          false;

        const promise =
          spawnPortableReleaseFlockProcess(
            input,
            {
              spawn:
                (() =>
                  child) as never,
            },
          ).then(
            (
              lease: Readonly<{
                release: () => Promise<void>;
              }>,
            ) => {
              resolved =
                true;

              return lease;
            },
          );

        child.emit(
          "spawn",
        );

        await Promise.resolve();

        expect(
          resolved,
        ).toBe(
          false,
        );

        child.stdout.write(
          "BUSYBOOKIE_FLOCK_READY\n",
        );

        const lease =
          await promise;

        const release =
          lease.release();

        child.exitCode =
          0;

        child.emit(
          "exit",
          0,
          null,
        );

        await release;
      },
    );

    it(
      "fails acquisition when the child emits error before readiness",
      async () => {
        const child =
          fakeChild();

        const promise =
          spawnPortableReleaseFlockProcess(
            input,
            {
              spawn:
                (() =>
                  child) as never,
            },
          );

        child.emit(
          "error",
          new Error(
            "spawn-failure",
          ),
        );

        await expect(
          promise,
        ).rejects.toThrow(
          /spawn-failure/u,
        );
      },
    );

    it(
      "fails acquisition when flock exits before readiness",
      async () => {
        const child =
          fakeChild();

        const promise =
          spawnPortableReleaseFlockProcess(
            input,
            {
              spawn:
                (() =>
                  child) as never,
            },
          );

        child.stderr.write(
          "flock: failed\n",
        );

        child.exitCode =
          1;

        child.emit(
          "exit",
          1,
          null,
        );

        await expect(
          promise,
        ).rejects.toThrow(
          /flock|failed|exit/u,
        );
      },
    );

    it(
      "rejects malformed readiness output instead of accepting ambiguous stdout",
      async () => {
        const child =
          fakeChild();

        const promise =
          spawnPortableReleaseFlockProcess(
            input,
            {
              spawn:
                (() =>
                  child) as never,
            },
          );

        child.stdout.write(
          "NOT_READY\n",
        );

        child.exitCode =
          1;

        child.emit(
          "exit",
          1,
          null,
        );

        await expect(
          promise,
        ).rejects.toThrow(
          /readiness|stdout|exit/u,
        );
      },
    );

    it(
      "does not report malformed readiness failure until the child has been released and exited",
      async () => {
        const child =
          fakeChild();

        let settled =
          false;

        const outcome =
          spawnPortableReleaseFlockProcess(
            input,
            {
              spawn:
                (() =>
                  child) as never,
            },
          ).then(
            () => {
              settled =
                true;

              return Object.freeze({
                status:
                  "fulfilled" as const,

                error:
                  null,
              });
            },
            error => {
              settled =
                true;

              return Object.freeze({
                status:
                  "rejected" as const,

                error,
              });
            },
          );

        child.emit(
          "spawn",
        );

        child.stdout.write(
          "NOT_BUSYBOOKIE_FLOCK_READY\n",
        );

        await Promise.resolve();
        await Promise.resolve();

        const stdinEndedBeforeExit =
          child.stdin.writableEnded;

        const settledBeforeExit =
          settled;

        child.exitCode =
          0;

        child.emit(
          "exit",
          0,
          null,
        );

        const result =
          await outcome;

        expect(
          stdinEndedBeforeExit,
        ).toBe(
          true,
        );

        expect(
          settledBeforeExit,
        ).toBe(
          false,
        );

        expect(
          result.status,
        ).toBe(
          "rejected",
        );

        if (
          result.status !==
            "rejected"
        ) {
          throw new Error(
            "Malformed readiness unexpectedly resolved acquisition.",
          );
        }

        expect(
          result.error,
        ).toBeInstanceOf(
          Error,
        );

        expect(
          (
            result.error as Error
          ).message,
        ).toMatch(
          /readiness/u,
        );
      },
    );

    it(
      "rejects the original readiness failure if the child errors during cleanup instead of exiting",
      async () => {
        const child =
          fakeChild();

        let settled =
          false;

        const outcome =
          spawnPortableReleaseFlockProcess(
            input,
            {
              spawn:
                (() =>
                  child) as never,
            },
          ).then(
            () => {
              settled =
                true;

              return Object.freeze({
                status:
                  "fulfilled" as const,

                error:
                  null,
              });
            },
            error => {
              settled =
                true;

              return Object.freeze({
                status:
                  "rejected" as const,

                error,
              });
            },
          );

        child.stdout.write(
          "NOT_BUSYBOOKIE_FLOCK_READY\n",
        );

        await Promise.resolve();
        await Promise.resolve();

        expect(
          child.stdin.writableEnded,
        ).toBe(
          true,
        );

        expect(
          settled,
        ).toBe(
          false,
        );

        child.emit(
          "error",
          new Error(
            "cleanup transport failure",
          ),
        );

        await Promise.resolve();
        await Promise.resolve();

        expect(
          settled,
        ).toBe(
          true,
        );

        const result =
          await outcome;

        expect(
          result.status,
        ).toBe(
          "rejected",
        );

        if (
          result.status !==
            "rejected"
        ) {
          throw new Error(
            "Malformed readiness unexpectedly resolved acquisition.",
          );
        }

        expect(
          result.error,
        ).toBeInstanceOf(
          Error,
        );

        expect(
          (
            result.error as Error
          ).message,
        ).toMatch(
          /readiness output was invalid/u,
        );
      },
    );

    it(
      "times out missing readiness, releases the child, waits for exit, then rejects",
      async () => {
        vi.useFakeTimers();

        try {
          const child =
            fakeChild();

          let settled =
            false;

          const outcome =
            spawnPortableReleaseFlockProcess(
              input,
              {
                spawn:
                  (() =>
                    child) as never,
              },
            ).then(
              () => {
                settled =
                  true;

                return Object.freeze({
                  status:
                    "fulfilled" as const,

                  error:
                    null,
                });
              },
              error => {
                settled =
                  true;

                return Object.freeze({
                  status:
                    "rejected" as const,

                  error,
                });
              },
            );

          child.emit(
            "spawn",
          );

          await vi.advanceTimersByTimeAsync(
            40_000,
          );

          const stdinEndedBeforeExit =
            child.stdin.writableEnded;

          const settledBeforeExit =
            settled;

          child.exitCode =
            0;

          child.emit(
            "exit",
            0,
            null,
          );

          const result =
            await outcome;

          expect(
            stdinEndedBeforeExit,
          ).toBe(
            true,
          );

          expect(
            settledBeforeExit,
          ).toBe(
            false,
          );

          expect(
            result.status,
          ).toBe(
            "rejected",
          );

          if (
            result.status !==
              "rejected"
          ) {
            throw new Error(
              "Missing readiness unexpectedly resolved acquisition.",
            );
          }

          expect(
            result.error,
          ).toBeInstanceOf(
            Error,
          );

          expect(
            (
              result.error as Error
            ).message,
          ).toMatch(
            /readiness.*timed out|timed out.*readiness/u,
          );
        } finally {
          vi.useRealTimers();
        }
      },
    );

    it(
      "cancels the readiness watchdog after successful acquisition without releasing the held lock",
      async () => {
        vi.useFakeTimers();

        try {
          const child =
            fakeChild();

          const promise =
            spawnPortableReleaseFlockProcess(
              input,
              {
                spawn:
                  (() =>
                    child) as never,
              },
            );

          child.stdout.write(
            "BUSYBOOKIE_FLOCK_READY\n",
          );

          const lease =
            await promise;

          await vi.advanceTimersByTimeAsync(
            40_000,
          );

          expect(
            child.stdin.writableEnded,
          ).toBe(
            false,
          );

          const releasePromise =
            lease.release();

          expect(
            child.stdin.writableEnded,
          ).toBe(
            true,
          );

          child.exitCode =
            0;

          child.emit(
            "exit",
            0,
            null,
          );

          await releasePromise;
        } finally {
          vi.useRealTimers();
        }
      },
    );

    it(
      "releases by ending stdin and waiting for clean exit",
      async () => {
        const child =
          fakeChild();

        const end =
          vi.spyOn(
            child.stdin,
            "end",
          );

        const promise =
          spawnPortableReleaseFlockProcess(
            input,
            {
              spawn:
                (() =>
                  child) as never,
            },
          );

        child.stdout.write(
          "BUSYBOOKIE_FLOCK_READY\n",
        );

        const lease =
          await promise;

        const releasePromise =
          lease.release();

        expect(
          end,
        ).toHaveBeenCalledTimes(
          1,
        );

        child.exitCode =
          0;

        child.emit(
          "exit",
          0,
          null,
        );

        await releasePromise;
      },
    );

    it(
      "fails release on nonzero child exit",
      async () => {
        const child =
          fakeChild();

        const promise =
          spawnPortableReleaseFlockProcess(
            input,
            {
              spawn:
                (() =>
                  child) as never,
            },
          );

        child.stdout.write(
          "BUSYBOOKIE_FLOCK_READY\n",
        );

        const lease =
          await promise;

        const releasePromise =
          lease.release();

        child.stderr.write(
          "unexpected-exit\n",
        );

        child.exitCode =
          2;

        child.emit(
          "exit",
          2,
          null,
        );

        await expect(
          releasePromise,
        ).rejects.toThrow(
          /unexpected-exit|exit/u,
        );
      },
    );

    it(
      "makes successful process release idempotent",
      async () => {
        const child =
          fakeChild();

        const end =
          vi.spyOn(
            child.stdin,
            "end",
          );

        const promise =
          spawnPortableReleaseFlockProcess(
            input,
            {
              spawn:
                (() =>
                  child) as never,
            },
          );

        child.stdout.write(
          "BUSYBOOKIE_FLOCK_READY\n",
        );

        const lease =
          await promise;

        const first =
          lease.release();

        child.exitCode =
          0;

        child.emit(
          "exit",
          0,
          null,
        );

        await first;
        await lease.release();

        expect(
          end,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );
  },
);
