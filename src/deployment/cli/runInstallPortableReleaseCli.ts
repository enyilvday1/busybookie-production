import {
  installPortableRelease,
  type PortableReleaseInstallationResult,
} from "../installPortableRelease.js";

import {
  parseInstallPortableReleaseCliArgs,
} from "./installPortableReleaseCliArgs.js";

// Thin operator adapter: parse explicit authority inputs, call the installer exactly once and render
// its durable result. All transactional semantics (verification, npm preparation, provenance,
// publication, receipts, replay, quarantine and rollback) stay inside installPortableRelease.
export type RunInstallPortableReleaseCliDependencies =
  Readonly<{
    install:
      typeof installPortableRelease;

    currentDirectory:
      () => string;

    writeStdout:
      (
        text: string,
      ) => void;
  }>;

const defaultDependencies:
  RunInstallPortableReleaseCliDependencies =
    Object.freeze({
      install:
        installPortableRelease,

      currentDirectory:
        () =>
          process.cwd(),

      writeStdout:
        (
          text: string,
        ) => {
          process.stdout.write(
            text,
          );
        },
    });

const FAILURE_PREFIX =
  "Portable release installation failed:";

// The installer result is already the receipt-derived authority record; it is emitted unchanged.
export function formatInstallPortableReleaseResult(
  result: PortableReleaseInstallationResult,
): string {
  return `${JSON.stringify(
    result,
    null,
    2,
  )}\n`;
}

// First line only, bounded, never a stack or cause chain. Installer messages already carry the
// failure prefix and are passed through verbatim.
export function formatInstallPortableReleaseCliError(
  error: unknown,
): string {
  if (
    !(
      error instanceof Error
    )
  ) {
    return `${FAILURE_PREFIX} non-error failure value.\n`;
  }

  const first =
    error.message.split(
      /\r?\n/,
    )[0] ??
    "";

  const bounded =
    first.length >
      500
      ? `${first.slice(
        0,
        500,
      )}...`
      : first;

  if (
    bounded.startsWith(
      FAILURE_PREFIX,
    )
  ) {
    return `${bounded}\n`;
  }

  return `${FAILURE_PREFIX} ${bounded || "unknown error"}\n`;
}

export async function runInstallPortableReleaseCli(
  args: readonly string[] =
    process.argv.slice(
      2,
    ),
  dependencies: RunInstallPortableReleaseCliDependencies =
    defaultDependencies,
): Promise<void> {
  const options =
    parseInstallPortableReleaseCliArgs(
      args,
      dependencies.currentDirectory(),
    );

  const result =
    await dependencies.install(
      options,
    );

  dependencies.writeStdout(
    formatInstallPortableReleaseResult(
      result,
    ),
  );
}
