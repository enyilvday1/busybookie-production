import { fileURLToPath } from "node:url";

import {
  readBoundFile,
  requireLinkSafeContainedPath,
} from "../execution/episodeInputBinding.js";
import {
  requirePortableReleaseIdentity,
  requirePortableReleaseWorkingDirectory,
} from "../execution/portableReleaseRuntimeIdentity.js";
import {
  formatOperatorServerCliError,
  runOperatorServerCli,
} from "./cli/runOperatorServerCli.js";

// The compiled production entry (npm start). In order, before console assets
// load, before anything listens and before the one-time token is printed:
//   1. the working directory must be exactly the release root, because
//      runtime inputs resolve from it;
//   2. the portable release identity must verify.
// The release root is the one the console assets are served from: two levels
// above this module. Neither arguments nor environment can select it.
// The source development path (scripts/operator-server.ts) does not use this.
const RELEASE_ROOT =
  fileURLToPath(
    new URL(
      "../../",
      import.meta.url,
    ),
  );

Promise.resolve()
  .then(
    () =>
      requirePortableReleaseWorkingDirectory(
        RELEASE_ROOT,
        process.cwd(),
      ),
  )
  .then(
    () =>
      requirePortableReleaseIdentity(
        RELEASE_ROOT,
        {
          readBoundFile,
          requireLinkSafeContainedPath,
        },
      ),
  )
  .then(
    () => runOperatorServerCli(),
  )
  .catch(
    (error: unknown) => {
      process.stderr.write(
        formatOperatorServerCliError(
          error,
        ),
      );

      process.exitCode = 1;
    },
  );
