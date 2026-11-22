import {
  formatInstallPortableReleaseCliError,
  runInstallPortableReleaseCli,
} from "../src/deployment/cli/runInstallPortableReleaseCli.js";

runInstallPortableReleaseCli().catch(
  (error: unknown) => {
    process.stderr.write(
      formatInstallPortableReleaseCliError(
        error,
      ),
    );

    process.exitCode = 1;
  },
);
