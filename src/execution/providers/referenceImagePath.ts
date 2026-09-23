import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

export function assertReferenceImageInsideRoot(
  mediaRoot: string,
  sourceImagePath: string,
): string {
  const normalizedMediaRoot =
    mediaRoot.trim();

  if (!normalizedMediaRoot) {
    throw new Error(
      "Busybookie media root is required.",
    );
  }

  if (
    !isAbsolute(
      normalizedMediaRoot,
    )
  ) {
    throw new Error(
      "Busybookie media root must be absolute.",
    );
  }

  const normalizedSourcePath =
    sourceImagePath.trim();

  if (!normalizedSourcePath) {
    throw new Error(
      "Reference image path is required.",
    );
  }

  if (
    !isAbsolute(
      normalizedSourcePath,
    )
  ) {
    throw new Error(
      "Reference image path must be absolute.",
    );
  }

  const referenceRoot =
    resolve(
      normalizedMediaRoot,
      "references",
    );

  const absoluteSourcePath =
    resolve(
      normalizedSourcePath,
    );

  const relativePath =
    relative(
      referenceRoot,
      absoluteSourcePath,
    );

  if (
    relativePath === ".." ||
    relativePath.startsWith(
      `..${sep}`,
    ) ||
    isAbsolute(
      relativePath,
    )
  ) {
    throw new Error(
      `Reference image must be inside ${referenceRoot}.`,
    );
  }

  return absoluteSourcePath;
}
