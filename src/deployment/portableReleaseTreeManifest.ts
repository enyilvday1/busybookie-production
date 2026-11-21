import {
  isAbsolute,
} from "node:path";

export type PortableReleaseTreeManifestEntry =
  Readonly<{
    sha256: string;
    relativePath: string;
  }>;

const MANIFEST_LINE_PATTERN =
  /^([a-f0-9]{64}) \*\.\/(.+)$/u;

function fail(): Error {
  return new Error(
    "Portable release whole-tree manifest is invalid.",
  );
}

function parseRelativePath(
  value: string,
): string {
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    isAbsolute(value) ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(
      value,
    )
  ) {
    throw fail();
  }

  const segments =
    value.split("/");

  if (
    segments.some(
      segment =>
        segment.length === 0 ||
        segment === "." ||
        segment === "..",
    )
  ) {
    throw fail();
  }

  return value;
}

function parseManifestLine(
  line: string,
): PortableReleaseTreeManifestEntry {
  const match =
    MANIFEST_LINE_PATTERN.exec(
      line,
    );

  if (match === null) {
    throw fail();
  }

  const sha256 =
    match[1];

  const relativePath =
    match[2];

  if (
    sha256 === undefined ||
    relativePath === undefined
  ) {
    throw fail();
  }

  return Object.freeze({
    sha256,
    relativePath:
      parseRelativePath(
        relativePath,
      ),
  });
}

export function parsePortableReleaseTreeManifest(
  bytes: Buffer,
): readonly PortableReleaseTreeManifestEntry[] {
  let text: string;

  try {
    text =
      new TextDecoder(
        "utf-8",
        {
          fatal: true,
        },
      ).decode(
        bytes,
      );
  } catch {
    throw fail();
  }

  if (
    text.length === 0 ||
    !text.endsWith("\n") ||
    text.includes("\r")
  ) {
    throw fail();
  }

  const lines =
    text
      .slice(
        0,
        -1,
      )
      .split("\n");

  if (
    lines.length === 0 ||
    lines.some(
      line =>
        line.length === 0,
    )
  ) {
    throw fail();
  }

  const entries =
    lines.map(
      parseManifestLine,
    );

  for (
    let index = 1;
    index < entries.length;
    index += 1
  ) {
    const previous =
      entries[index - 1];

    const current =
      entries[index];

    if (
      previous === undefined ||
      current === undefined ||
      previous.relativePath >=
        current.relativePath
    ) {
      throw fail();
    }
  }

  return Object.freeze(
    entries,
  );
}
