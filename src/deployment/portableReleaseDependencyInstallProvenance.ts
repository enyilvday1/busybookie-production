import {
  writeFile,
} from "node:fs/promises";

import {
  resolve,
} from "node:path";

import {
  portableReleaseInstallFailure as fail,
} from "./portableReleaseInstallContract.js";

export const PORTABLE_RELEASE_DEPENDENCY_INSTALL_PROVENANCE_FILE =
  ".busybookie-install-provenance.json";

export const PORTABLE_RELEASE_DEPENDENCY_INSTALL_PROVENANCE_SCHEMA_VERSION =
  "1.0";

export const PORTABLE_RELEASE_DEPENDENCY_INSTALL_PROVENANCE_KIND =
  "BUSYBOOKIE_PORTABLE_RELEASE_DEPENDENCY_INSTALL_PROVENANCE";

const MAX_PROVENANCE_TOKEN_LENGTH =
  256;

const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u001f\u007f]/u;

const PROVENANCE_KEYS =
  Object.freeze([
    "schemaVersion",
    "kind",
    "nodeVersion",
    "npmVersion",
    "platform",
    "arch",
  ]);

export type PortableReleaseDependencyInstallProvenance =
  Readonly<{
    schemaVersion:
      typeof PORTABLE_RELEASE_DEPENDENCY_INSTALL_PROVENANCE_SCHEMA_VERSION;

    kind:
      typeof PORTABLE_RELEASE_DEPENDENCY_INSTALL_PROVENANCE_KIND;

    nodeVersion:
      string;

    npmVersion:
      string;

    platform:
      string;

    arch:
      string;
  }>;

function requireCanonicalToken(
  value: unknown,
  label: string,
): string {
  if (
    typeof value !==
      "string" ||
    value.length <
      1 ||
    value.length >
      MAX_PROVENANCE_TOKEN_LENGTH ||
    value.trim() !==
      value ||
    CONTROL_CHARACTER_PATTERN.test(
      value,
    )
  ) {
    throw fail(
      `${label} is not a valid dependency-install provenance token.`,
    );
  }

  return value;
}

function requireExactKeys(
  value: Record<string, unknown>,
): void {
  const actual =
    Object.keys(
      value,
    ).sort();

  const expected =
    [...PROVENANCE_KEYS].sort();

  if (
    actual.length !==
      expected.length ||
    actual.some(
      (
        key,
        index,
      ) =>
        key !==
        expected[index],
    )
  ) {
    throw fail(
      "Dependency-install provenance has an invalid shape.",
    );
  }
}

export function createPortableReleaseDependencyInstallProvenance(
  input: Readonly<{
    nodeVersion: string;
    npmVersion: string;
    platform: string;
    arch: string;
  }>,
): PortableReleaseDependencyInstallProvenance {
  return Object.freeze({
    schemaVersion:
      PORTABLE_RELEASE_DEPENDENCY_INSTALL_PROVENANCE_SCHEMA_VERSION,

    kind:
      PORTABLE_RELEASE_DEPENDENCY_INSTALL_PROVENANCE_KIND,

    nodeVersion:
      requireCanonicalToken(
        input.nodeVersion,
        "Node version",
      ),

    npmVersion:
      requireCanonicalToken(
        input.npmVersion,
        "npm version",
      ),

    platform:
      requireCanonicalToken(
        input.platform,
        "Platform",
      ),

    arch:
      requireCanonicalToken(
        input.arch,
        "Architecture",
      ),
  });
}

export function serializePortableReleaseDependencyInstallProvenance(
  provenance: PortableReleaseDependencyInstallProvenance,
): Buffer {
  const canonical =
    createPortableReleaseDependencyInstallProvenance({
      nodeVersion:
        provenance.nodeVersion,

      npmVersion:
        provenance.npmVersion,

      platform:
        provenance.platform,

      arch:
        provenance.arch,
    });

  return Buffer.from(
    `${JSON.stringify(
      canonical,
    )}\n`,
    "utf8",
  );
}

export function parsePortableReleaseDependencyInstallProvenance(
  bytes: Buffer,
): PortableReleaseDependencyInstallProvenance {
  let raw:
    unknown;

  try {
    raw =
      JSON.parse(
        new TextDecoder(
          "utf-8",
          {
            fatal:
              true,
          },
        ).decode(
          bytes,
        ),
      );
  } catch (cause) {
    throw fail(
      "Dependency-install provenance is not valid UTF-8 JSON.",
      {
        cause,
      },
    );
  }

  if (
    raw ===
      null ||
    typeof raw !==
      "object" ||
    Array.isArray(
      raw,
    )
  ) {
    throw fail(
      "Dependency-install provenance has an invalid shape.",
    );
  }

  const value =
    raw as
      Record<string, unknown>;

  requireExactKeys(
    value,
  );

  if (
    value.schemaVersion !==
      PORTABLE_RELEASE_DEPENDENCY_INSTALL_PROVENANCE_SCHEMA_VERSION ||
    value.kind !==
      PORTABLE_RELEASE_DEPENDENCY_INSTALL_PROVENANCE_KIND
  ) {
    throw fail(
      "Dependency-install provenance contains invalid authority fields.",
    );
  }

  const provenance =
    createPortableReleaseDependencyInstallProvenance({
      nodeVersion:
        requireCanonicalToken(
          value.nodeVersion,
          "Node version",
        ),

      npmVersion:
        requireCanonicalToken(
          value.npmVersion,
          "npm version",
        ),

      platform:
        requireCanonicalToken(
          value.platform,
          "Platform",
        ),

      arch:
        requireCanonicalToken(
          value.arch,
          "Architecture",
        ),
    });

  const canonicalBytes =
    serializePortableReleaseDependencyInstallProvenance(
      provenance,
    );

  if (
    !bytes.equals(
      canonicalBytes,
    )
  ) {
    throw fail(
      "Dependency-install provenance is not canonically serialized.",
    );
  }

  return provenance;
}

export async function writePortableReleaseDependencyInstallProvenance(
  dependencyRoot: string,
  provenance: PortableReleaseDependencyInstallProvenance,
): Promise<string> {
  const provenancePath =
    resolve(
      dependencyRoot,
      PORTABLE_RELEASE_DEPENDENCY_INSTALL_PROVENANCE_FILE,
    );

  try {
    await writeFile(
      provenancePath,
      serializePortableReleaseDependencyInstallProvenance(
        provenance,
      ),
      {
        flag:
          "wx",

        mode:
          0o600,
      },
    );
  } catch (cause) {
    throw fail(
      "Dependency-install provenance could not be written exactly once.",
      {
        cause,
      },
    );
  }

  return provenancePath;
}
