import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  createPortableReleaseDependencyInstallProvenance,
  parsePortableReleaseDependencyInstallProvenance,
  PORTABLE_RELEASE_DEPENDENCY_INSTALL_PROVENANCE_FILE,
  PORTABLE_RELEASE_DEPENDENCY_INSTALL_PROVENANCE_KIND,
  PORTABLE_RELEASE_DEPENDENCY_INSTALL_PROVENANCE_SCHEMA_VERSION,
  serializePortableReleaseDependencyInstallProvenance,
  writePortableReleaseDependencyInstallProvenance,
} from "../src/deployment/portableReleaseDependencyInstallProvenance.js";

const temporaryRoots:
  string[] =
    [];

async function temporaryRoot(): Promise<string> {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-dependency-provenance-",
      ),
    );

  temporaryRoots.push(
    root,
  );

  return root;
}

function provenance() {
  return createPortableReleaseDependencyInstallProvenance({
    nodeVersion:
      "v24.11.0",

    npmVersion:
      "11.11.1",

    platform:
      "linux",

    arch:
      "x64",
  });
}

afterEach(
  async () => {
    for (
      const root
      of temporaryRoots.splice(
        0,
      )
    ) {
      await rm(
        root,
        {
          recursive:
            true,

          force:
            true,
        },
      );
    }
  },
);

describe(
  "portable release dependency-install provenance",
  () => {
    it(
      "creates the exact frozen versioned authority object",
      () => {
        const value =
          provenance();

        expect(
          value,
        ).toEqual({
          schemaVersion:
            PORTABLE_RELEASE_DEPENDENCY_INSTALL_PROVENANCE_SCHEMA_VERSION,

          kind:
            PORTABLE_RELEASE_DEPENDENCY_INSTALL_PROVENANCE_KIND,

          nodeVersion:
            "v24.11.0",

          npmVersion:
            "11.11.1",

          platform:
            "linux",

          arch:
            "x64",
        });

        expect(
          Object.isFrozen(
            value,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "serializes exact deterministic UTF-8 JSON with one final newline",
      () => {
        expect(
          serializePortableReleaseDependencyInstallProvenance(
            provenance(),
          ),
        ).toEqual(
          Buffer.from(
            '{"schemaVersion":"1.0","kind":"BUSYBOOKIE_PORTABLE_RELEASE_DEPENDENCY_INSTALL_PROVENANCE","nodeVersion":"v24.11.0","npmVersion":"11.11.1","platform":"linux","arch":"x64"}\n',
            "utf8",
          ),
        );
      },
    );

    it(
      "parses only the canonical deterministic representation",
      () => {
        const value =
          provenance();

        const bytes =
          serializePortableReleaseDependencyInstallProvenance(
            value,
          );

        const parsed =
          parsePortableReleaseDependencyInstallProvenance(
            bytes,
          );

        expect(
          parsed,
        ).toEqual(
          value,
        );

        expect(
          Object.isFrozen(
            parsed,
          ),
        ).toBe(
          true,
        );

        expect(
          () =>
            parsePortableReleaseDependencyInstallProvenance(
              Buffer.from(
                JSON.stringify(
                  value,
                  null,
                  2,
                ) + "\n",
                "utf8",
              ),
            ),
        ).toThrow(
          "Portable release installation failed: Dependency-install provenance is not canonically serialized.",
        );
      },
    );

    it(
      "rejects extra fields and invalid authority tokens",
      () => {
        expect(
          () =>
            parsePortableReleaseDependencyInstallProvenance(
              Buffer.from(
                '{"schemaVersion":"1.0","kind":"BUSYBOOKIE_PORTABLE_RELEASE_DEPENDENCY_INSTALL_PROVENANCE","nodeVersion":"v24.11.0","npmVersion":"11.11.1","platform":"linux","arch":"x64","unexpected":true}\n',
                "utf8",
              ),
            ),
        ).toThrow(
          "Portable release installation failed: Dependency-install provenance has an invalid shape.",
        );

        expect(
          () =>
            createPortableReleaseDependencyInstallProvenance({
              nodeVersion:
                " v24.11.0",

              npmVersion:
                "11.11.1",

              platform:
                "linux",

              arch:
                "x64",
            }),
        ).toThrow(
          "Portable release installation failed: Node version is not a valid dependency-install provenance token.",
        );

        expect(
          () =>
            createPortableReleaseDependencyInstallProvenance({
              nodeVersion:
                "v24.11.0",

              npmVersion:
                "11.11.1\nother",

              platform:
                "linux",

              arch:
                "x64",
            }),
        ).toThrow(
          "Portable release installation failed: npm version is not a valid dependency-install provenance token.",
        );
      },
    );

    it(
      "writes the reserved dependency-tree provenance file exactly once",
      async () => {
        const root =
          await temporaryRoot();

        const path =
          await writePortableReleaseDependencyInstallProvenance(
            root,
            provenance(),
          );

        expect(
          path,
        ).toBe(
          join(
            root,
            PORTABLE_RELEASE_DEPENDENCY_INSTALL_PROVENANCE_FILE,
          ),
        );

        expect(
          await readFile(
            path,
          ),
        ).toEqual(
          serializePortableReleaseDependencyInstallProvenance(
            provenance(),
          ),
        );

        await expect(
          writePortableReleaseDependencyInstallProvenance(
            root,
            provenance(),
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Dependency-install provenance could not be written exactly once.",
        );

        expect(
          await readFile(
            path,
          ),
        ).toEqual(
          serializePortableReleaseDependencyInstallProvenance(
            provenance(),
          ),
        );
      },
    );

    it(
      "rejects a wrong schema or kind even when the JSON shape is otherwise exact",
      () => {
        expect(
          () =>
            parsePortableReleaseDependencyInstallProvenance(
              Buffer.from(
                '{"schemaVersion":"2.0","kind":"BUSYBOOKIE_PORTABLE_RELEASE_DEPENDENCY_INSTALL_PROVENANCE","nodeVersion":"v24.11.0","npmVersion":"11.11.1","platform":"linux","arch":"x64"}\n',
                "utf8",
              ),
            ),
        ).toThrow(
          "Portable release installation failed: Dependency-install provenance contains invalid authority fields.",
        );

        expect(
          () =>
            parsePortableReleaseDependencyInstallProvenance(
              Buffer.from(
                '{"schemaVersion":"1.0","kind":"OTHER","nodeVersion":"v24.11.0","npmVersion":"11.11.1","platform":"linux","arch":"x64"}\n',
                "utf8",
              ),
            ),
        ).toThrow(
          "Portable release installation failed: Dependency-install provenance contains invalid authority fields.",
        );
      },
    );

    it(
      "does not overwrite a pre-existing reserved provenance path",
      async () => {
        const root =
          await temporaryRoot();

        const path =
          join(
            root,
            PORTABLE_RELEASE_DEPENDENCY_INSTALL_PROVENANCE_FILE,
          );

        const original =
          Buffer.from(
            "pre-existing\n",
            "utf8",
          );

        await writeFile(
          path,
          original,
          {
            flag:
              "wx",
          },
        );

        await expect(
          writePortableReleaseDependencyInstallProvenance(
            root,
            provenance(),
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Dependency-install provenance could not be written exactly once.",
        );

        expect(
          await readFile(
            path,
          ),
        ).toEqual(
          original,
        );
      },
    );
  },
);
