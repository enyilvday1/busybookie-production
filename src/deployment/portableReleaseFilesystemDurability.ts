import {
  constants,
} from "node:fs";

import {
  open,
} from "node:fs/promises";

export async function syncPortableReleaseDirectory(
  directory: string,
): Promise<void> {
  const handle =
    await open(
      directory,
      constants.O_RDONLY,
    );

  try {
    try {
      await handle.sync();
    } catch (cause) {
      if (
        process.platform ===
          "win32" &&
        cause instanceof Error &&
        "code" in cause &&
        cause.code ===
          "EPERM"
      ) {
        return;
      }

      throw cause;
    }
  } finally {
    await handle.close();
  }
}
