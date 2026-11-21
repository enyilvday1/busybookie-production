import {
  createHash,
} from "node:crypto";

import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
  resolve,
} from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  PORTABLE_RELEASE_PRODUCTION_NPM_CI_ARGS,
  collectPortableReleaseDependencyInstallProvenance,
  preparePortableReleaseProductionDependencies,
  type PortableReleaseDependencyInstallProvenanceCollector,
  type PortableReleaseDependencyInstallRunner,
} from "../src/deployment/portableReleaseDependencyPreparation.js";

import {
  createPortableReleaseDependencyTreeManifest,
  type PortableReleaseDependencyTreeManifest,
} from "../src/deployment/portableReleaseDependencyTreeManifest.js";

import {
  PORTABLE_RELEASE_DEPENDENCY_INSTALL_PROVENANCE_FILE,
  createPortableReleaseDependencyInstallProvenance,
  serializePortableReleaseDependencyInstallProvenance,
} from "../src/deployment/portableReleaseDependencyInstallProvenance.js";

const PROVENANCE_INPUT =
  Object.freeze({
    nodeVersion:
      "v24.11.0",

    npmVersion:
      "11.11.1",

    platform:
      "linux",

    arch:
      "x64",
  });

const EXPECTED_PROVENANCE_BYTES =
  serializePortableReleaseDependencyInstallProvenance(
    createPortableReleaseDependencyInstallProvenance(
      PROVENANCE_INPUT,
    ),
  );

function recordingCollector(
  events:
    string[],
  cwds:
    string[] =
      [],
): PortableReleaseDependencyInstallProvenanceCollector {
  return async input => {
    events.push(
      "collector",
    );

    expect(
      Object.keys(
        input,
      ).sort(),
    ).toEqual([
      "cwd",
      "npmExecutable",
    ]);

    expect(
      input.npmExecutable,
    ).toBe(
      "npm",
    );

    cwds.push(
      input.cwd,
    );

    return PROVENANCE_INPUT;
  };
}

const temporaryRoots:
  string[] =
    [];

const PACKAGE_BYTES =
  Buffer.from(
    [
      "{",
      '  "name": "busybookie-dependency-fixture",',
      '  "version": "1.0.0",',
      '  "type": "module"',
      "}",
      "",
    ].join(
      "\n",
    ),
    "utf8",
  );

const LOCK_BYTES =
  Buffer.from(
    [
      "{",
      '  "name": "busybookie-dependency-fixture",',
      '  "version": "1.0.0",',
      '  "lockfileVersion": 3,',
      '  "requires": true,',
      '  "packages": {',
      '    "": {',
      '      "name": "busybookie-dependency-fixture",',
      '      "version": "1.0.0"',
      "    }",
      "  }",
      "}",
      "",
    ].join(
      "\n",
    ),
    "utf8",
  );

async function fixture(): Promise<
  Readonly<{
    root: string;
    revisionRoot: string;
    artifactRoot: string;
  }>
> {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-dependency-preparation-",
      ),
    );

  temporaryRoots.push(
    root,
  );

  const revisionRoot =
    join(
      root,
      "revision",
    );

  const artifactRoot =
    join(
      revisionRoot,
      "app",
    );

  await mkdir(
    artifactRoot,
    {
      recursive:
        true,
    },
  );

  await writeFile(
    join(
      artifactRoot,
      "package.json",
    ),
    PACKAGE_BYTES,
    {
      flag:
        "wx",
    },
  );

  await writeFile(
    join(
      artifactRoot,
      "package-lock.json",
    ),
    LOCK_BYTES,
    {
      flag:
        "wx",
    },
  );

  return Object.freeze({
    root,
    revisionRoot,
    artifactRoot,
  });
}

function successfulRunner(
  events:
    string[],
): PortableReleaseDependencyInstallRunner {
  return async input => {
    events.push(
      "runner",
    );

    expect(
      input.executable,
    ).toBe(
      "npm",
    );

    expect(
      input.args,
    ).toEqual([
      "ci",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-bin-links",
    ]);

    expect(
      input.args,
    ).toEqual(
      PORTABLE_RELEASE_PRODUCTION_NPM_CI_ARGS,
    );

    expect(
      await readFile(
        join(
          input.cwd,
          "package.json",
        ),
      ),
    ).toEqual(
      PACKAGE_BYTES,
    );

    expect(
      await readFile(
        join(
          input.cwd,
          "package-lock.json",
        ),
      ),
    ).toEqual(
      LOCK_BYTES,
    );

    await mkdir(
      join(
        input.cwd,
        "node_modules",
        "alpha",
      ),
      {
        recursive:
          true,
      },
    );

    await writeFile(
      join(
        input.cwd,
        "node_modules",
        ".package-lock.json",
      ),
      "{\"lockfileVersion\":3}\n",
      {
        flag:
          "wx",
      },
    );

    await writeFile(
      join(
        input.cwd,
        "node_modules",
        "alpha",
        "index.js",
      ),
      "export const alpha = true;\n",
      {
        flag:
          "wx",
      },
    );
  };
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
  "portable release production dependency preparation",
  () => {
    it(
      "installs into a private work root, manifests dependencies, then publishes only sibling node_modules",
      async () => {
        const current =
          await fixture();

        const events:
          string[] =
            [];

        const manifests:
          PortableReleaseDependencyTreeManifest[] =
            [];

        const runnerCwds:
          string[] =
            [];

        const collectorCwds:
          string[] =
            [];

        const result =
          await preparePortableReleaseProductionDependencies(
            {
              revisionRoot:
                current.revisionRoot,

              artifactRoot:
                current.artifactRoot,
            },
            {
              runInstall:
                async input => {
                  runnerCwds.push(
                    input.cwd,
                  );

                  await successfulRunner(
                    events,
                  )(
                    input,
                  );
                },

              collectInstallProvenance:
                recordingCollector(
                  events,
                  collectorCwds,
                ),

              createDependencyManifest:
                async dependencyRoot => {
                  events.push(
                    "manifest",
                  );

                  const manifest =
                    await createPortableReleaseDependencyTreeManifest(
                      dependencyRoot,
                    );

                  manifests.push(
                    manifest,
                  );

                  return manifest;
                },
            },
          );

        expect(
          events,
        ).toEqual([
          "runner",
          "collector",
          "manifest",
          "manifest",
        ]);

        expect(
          runnerCwds,
        ).toHaveLength(
          1,
        );

        expect(
          runnerCwds[0]?.startsWith(
            join(
              current.revisionRoot,
              ".dependency-install-",
            ),
          ),
        ).toBe(
          true,
        );

        expect(
          collectorCwds,
        ).toEqual(
          runnerCwds,
        );

        expect(
          manifests,
        ).toHaveLength(
          2,
        );

        expect(
          manifests[1],
        ).toEqual(
          manifests[0],
        );

        expect(
          result,
        ).toBe(
          manifests[1],
        );

        expect(
          result.fileCount,
        ).toBe(
          3,
        );

        expect(
          result.manifestSha256,
        ).toMatch(
          /^[a-f0-9]{64}$/u,
        );

        expect(
          result.files.map(
            file =>
              file.relativePath,
          ),
        ).toContain(
          PORTABLE_RELEASE_DEPENDENCY_INSTALL_PROVENANCE_FILE,
        );

        expect(
          PORTABLE_RELEASE_DEPENDENCY_INSTALL_PROVENANCE_FILE,
        ).toBe(
          ".busybookie-install-provenance.json",
        );

        const provenanceEntry =
          result.files.find(
            file =>
              file.relativePath ===
              ".busybookie-install-provenance.json",
          );

        expect(
          provenanceEntry,
        ).toBeDefined();

        expect(
          provenanceEntry?.bytes,
        ).toBe(
          EXPECTED_PROVENANCE_BYTES.length,
        );

        expect(
          provenanceEntry?.sha256,
        ).toBe(
          createHash(
            "sha256",
          ).update(
            EXPECTED_PROVENANCE_BYTES,
          ).digest(
            "hex",
          ),
        );

        expect(
          await readFile(
            join(
              current.revisionRoot,
              "node_modules",
              ".busybookie-install-provenance.json",
            ),
          ),
        ).toEqual(
          EXPECTED_PROVENANCE_BYTES,
        );

        expect(
          await readdir(
            current.revisionRoot,
          ),
        ).toEqual([
          "app",
          "node_modules",
        ]);

        expect(
          await readdir(
            current.artifactRoot,
          ),
        ).toEqual([
          "package-lock.json",
          "package.json",
        ]);

        await expect(
          readFile(
            join(
              current.artifactRoot,
              "node_modules",
              "alpha",
              "index.js",
            ),
          ),
        ).rejects.toThrow();

        expect(
          await readFile(
            join(
              current.revisionRoot,
              "node_modules",
              "alpha",
              "index.js",
            ),
            "utf8",
          ),
        ).toBe(
          "export const alpha = true;\n",
        );

        expect(
          await readFile(
            join(
              current.artifactRoot,
              "package.json",
            ),
          ),
        ).toEqual(
          PACKAGE_BYTES,
        );

        expect(
          await readFile(
            join(
              current.artifactRoot,
              "package-lock.json",
            ),
          ),
        ).toEqual(
          LOCK_BYTES,
        );
      },
    );

    it(
      "fails before running npm when sibling dependency state already exists",
      async () => {
        const current =
          await fixture();

        await mkdir(
          join(
            current.revisionRoot,
            "node_modules",
          ),
        );

        let runs =
          0;

        await expect(
          preparePortableReleaseProductionDependencies(
            {
              revisionRoot:
                current.revisionRoot,

              artifactRoot:
                current.artifactRoot,
            },
            {
              runInstall:
                async () => {
                  runs +=
                    1;
                },
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Portable release revision container already contains dependency state.",
        );

        expect(
          runs,
        ).toBe(
          0,
        );
      },
    );

    it(
      "rejects an artifact root outside revision/app before running npm",
      async () => {
        const current =
          await fixture();

        const wrongArtifact =
          join(
            current.root,
            "wrong-app",
          );

        await mkdir(
          wrongArtifact,
        );

        let runs =
          0;

        await expect(
          preparePortableReleaseProductionDependencies(
            {
              revisionRoot:
                current.revisionRoot,

              artifactRoot:
                wrongArtifact,
            },
            {
              runInstall:
                async () => {
                  runs +=
                    1;
                },
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Portable release artifact root must be the app directory inside the revision container.",
        );

        expect(
          runs,
        ).toBe(
          0,
        );
      },
    );

    it(
      "cleans private dependency work state when the install runner fails",
      async () => {
        const current =
          await fixture();

        const events:
          string[] =
            [];

        await expect(
          preparePortableReleaseProductionDependencies(
            {
              revisionRoot:
                current.revisionRoot,

              artifactRoot:
                current.artifactRoot,
            },
            {
              runInstall:
                async input => {
                  await mkdir(
                    join(
                      input.cwd,
                      "node_modules",
                    ),
                  );

                  throw new Error(
                    "synthetic-install-failure",
                  );
                },

              collectInstallProvenance:
                recordingCollector(
                  events,
                ),
            },
          ),
        ).rejects.toThrow(
          "synthetic-install-failure",
        );

        expect(
          events,
        ).toEqual(
          [],
        );

        expect(
          await readdir(
            current.revisionRoot,
          ),
        ).toEqual([
          "app",
        ]);
      },
    );

    it(
      "fails closed and publishes no dependencies when npm changes package-lock.json",
      async () => {
        const current =
          await fixture();

        const events:
          string[] =
            [];

        await expect(
          preparePortableReleaseProductionDependencies(
            {
              revisionRoot:
                current.revisionRoot,

              artifactRoot:
                current.artifactRoot,
            },
            {
              runInstall:
                async input => {
                  await writeFile(
                    join(
                      input.cwd,
                      "package-lock.json",
                    ),
                    "{\"changed\":true}\n",
                  );

                  await mkdir(
                    join(
                      input.cwd,
                      "node_modules",
                    ),
                  );

                  await writeFile(
                    join(
                      input.cwd,
                      "node_modules",
                      "file.js",
                    ),
                    "x\n",
                  );
                },

              collectInstallProvenance:
                recordingCollector(
                  events,
                ),
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Production dependency installation changed package-lock.json.",
        );

        expect(
          events,
        ).toEqual(
          [],
        );

        expect(
          await readdir(
            current.revisionRoot,
          ),
        ).toEqual([
          "app",
        ]);
      },
    );

    it(
      "rejects dependency bytes changed after temporary manifest creation and before sibling publication",
      async () => {
        const current =
          await fixture();

        let manifestCalls =
          0;

        await expect(
          preparePortableReleaseProductionDependencies(
            {
              revisionRoot:
                current.revisionRoot,

              artifactRoot:
                current.artifactRoot,
            },
            {
              runInstall:
                successfulRunner(
                  [],
                ),

              collectInstallProvenance:
                recordingCollector(
                  [],
                ),

              createDependencyManifest:
                async dependencyRoot => {
                  manifestCalls +=
                    1;

                  const manifest =
                    await createPortableReleaseDependencyTreeManifest(
                      dependencyRoot,
                    );

                  if (
                    manifestCalls ===
                      1
                  ) {
                    await writeFile(
                      join(
                        dependencyRoot,
                        "alpha",
                        "index.js",
                      ),
                      "export const alpha = false;\n",
                    );
                  }

                  return manifest;
                },
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Published production dependencies do not match the verified dependency manifest.",
        );

        expect(
          manifestCalls,
        ).toBe(
          2,
        );

        expect(
          await readdir(
            current.revisionRoot,
          ),
        ).toEqual([
          "app",
        ]);
      },
    );

    it(
      "fails closed and publishes no dependencies when manifest verification rejects generated state",
      async () => {
        const current =
          await fixture();

        await expect(
          preparePortableReleaseProductionDependencies(
            {
              revisionRoot:
                current.revisionRoot,

              artifactRoot:
                current.artifactRoot,
            },
            {
              runInstall:
                successfulRunner(
                  [],
                ),

              collectInstallProvenance:
                recordingCollector(
                  [],
                ),

              createDependencyManifest:
                async () => {
                  throw new Error(
                    "synthetic-manifest-failure",
                  );
                },
            },
          ),
        ).rejects.toThrow(
          "synthetic-manifest-failure",
        );

        expect(
          await readdir(
            current.revisionRoot,
          ),
        ).toEqual([
          "app",
        ]);
      },
    );

    it(
      "rejects node_modules inside the verified artifact before running npm",
      async () => {
        const current =
          await fixture();

        await mkdir(
          join(
            current.artifactRoot,
            "node_modules",
          ),
        );

        let runs =
          0;

        await expect(
          preparePortableReleaseProductionDependencies(
            {
              revisionRoot:
                current.revisionRoot,

              artifactRoot:
                current.artifactRoot,
            },
            {
              runInstall:
                async () => {
                  runs +=
                    1;
                },
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Verified portable release artifact must remain free of node_modules.",
        );

        expect(
          runs,
        ).toBe(
          0,
        );
      },
    );

    it(
      "publishes to the canonical resolved sibling node_modules path",
      async () => {
        const current =
          await fixture();

        await preparePortableReleaseProductionDependencies(
          {
            revisionRoot:
              resolve(
                current.revisionRoot,
              ),

            artifactRoot:
              resolve(
                current.artifactRoot,
              ),
          },
          {
            runInstall:
              successfulRunner(
                [],
              ),

            collectInstallProvenance:
              recordingCollector(
                [],
              ),
          },
        );

        expect(
          await readFile(
            resolve(
              current.revisionRoot,
              "node_modules",
              "alpha",
              "index.js",
            ),
            "utf8",
          ),
        ).toBe(
          "export const alpha = true;\n",
        );
      },
    );

    it(
      "does not collect provenance and publishes no dependencies when npm changes package.json",
      async () => {
        const current =
          await fixture();

        const events:
          string[] =
            [];

        await expect(
          preparePortableReleaseProductionDependencies(
            {
              revisionRoot:
                current.revisionRoot,

              artifactRoot:
                current.artifactRoot,
            },
            {
              runInstall:
                async input => {
                  await successfulRunner(
                    [],
                  )(
                    input,
                  );

                  await writeFile(
                    join(
                      input.cwd,
                      "package.json",
                    ),
                    "{\"changed\":true}\n",
                  );
                },

              collectInstallProvenance:
                recordingCollector(
                  events,
                ),
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Production dependency installation changed package.json.",
        );

        expect(
          events,
        ).toEqual(
          [],
        );

        expect(
          await readdir(
            current.revisionRoot,
          ),
        ).toEqual([
          "app",
        ]);
      },
    );

    it(
      "does not collect provenance when npm creates no node_modules directory",
      async () => {
        const current =
          await fixture();

        const events:
          string[] =
            [];

        await expect(
          preparePortableReleaseProductionDependencies(
            {
              revisionRoot:
                current.revisionRoot,

              artifactRoot:
                current.artifactRoot,
            },
            {
              runInstall:
                async () => undefined,

              collectInstallProvenance:
                recordingCollector(
                  events,
                ),
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Production dependency installation did not create a safe node_modules directory.",
        );

        expect(
          events,
        ).toEqual(
          [],
        );

        expect(
          await readdir(
            current.revisionRoot,
          ),
        ).toEqual([
          "app",
        ]);
      },
    );

    it(
      "does not collect provenance when npm leaves node_modules as a non-directory",
      async () => {
        const current =
          await fixture();

        const events:
          string[] =
            [];

        await expect(
          preparePortableReleaseProductionDependencies(
            {
              revisionRoot:
                current.revisionRoot,

              artifactRoot:
                current.artifactRoot,
            },
            {
              runInstall:
                async input => {
                  await writeFile(
                    join(
                      input.cwd,
                      "node_modules",
                    ),
                    "not a directory\n",
                    {
                      flag:
                        "wx",
                    },
                  );
                },

              collectInstallProvenance:
                recordingCollector(
                  events,
                ),
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Production dependency installation did not create a safe node_modules directory.",
        );

        expect(
          events,
        ).toEqual(
          [],
        );

        expect(
          await readdir(
            current.revisionRoot,
          ),
        ).toEqual([
          "app",
        ]);
      },
    );

    it(
      "cleans private work state and publishes no dependencies when provenance collection fails",
      async () => {
        const current =
          await fixture();

        let manifestCalls =
          0;

        await expect(
          preparePortableReleaseProductionDependencies(
            {
              revisionRoot:
                current.revisionRoot,

              artifactRoot:
                current.artifactRoot,
            },
            {
              runInstall:
                successfulRunner(
                  [],
                ),

              collectInstallProvenance:
                async () => {
                  throw new Error(
                    "synthetic-collector-failure",
                  );
                },

              createDependencyManifest:
                async dependencyRoot => {
                  manifestCalls +=
                    1;

                  return createPortableReleaseDependencyTreeManifest(
                    dependencyRoot,
                  );
                },
            },
          ),
        ).rejects.toThrow(
          "synthetic-collector-failure",
        );

        expect(
          manifestCalls,
        ).toBe(
          0,
        );

        expect(
          await readdir(
            current.revisionRoot,
          ),
        ).toEqual([
          "app",
        ]);
      },
    );

    it(
      "rejects invalid collected provenance through the provenance model and publishes no dependencies",
      async () => {
        const current =
          await fixture();

        await expect(
          preparePortableReleaseProductionDependencies(
            {
              revisionRoot:
                current.revisionRoot,

              artifactRoot:
                current.artifactRoot,
            },
            {
              runInstall:
                successfulRunner(
                  [],
                ),

              collectInstallProvenance:
                async () => ({
                  ...PROVENANCE_INPUT,

                  npmVersion:
                    "",
                }),
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: npm version is not a valid dependency-install provenance token.",
        );

        expect(
          await readdir(
            current.revisionRoot,
          ),
        ).toEqual([
          "app",
        ]);
      },
    );

    it(
      "fails closed when npm output already contains a provenance file",
      async () => {
        const current =
          await fixture();

        const events:
          string[] =
            [];

        let manifestCalls =
          0;

        await expect(
          preparePortableReleaseProductionDependencies(
            {
              revisionRoot:
                current.revisionRoot,

              artifactRoot:
                current.artifactRoot,
            },
            {
              runInstall:
                async input => {
                  await successfulRunner(
                    [],
                  )(
                    input,
                  );

                  await writeFile(
                    join(
                      input.cwd,
                      "node_modules",
                      ".busybookie-install-provenance.json",
                    ),
                    EXPECTED_PROVENANCE_BYTES,
                    {
                      flag:
                        "wx",
                    },
                  );
                },

              collectInstallProvenance:
                recordingCollector(
                  events,
                ),

              createDependencyManifest:
                async dependencyRoot => {
                  manifestCalls +=
                    1;

                  return createPortableReleaseDependencyTreeManifest(
                    dependencyRoot,
                  );
                },
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Dependency-install provenance could not be written exactly once.",
        );

        expect(
          events,
        ).toEqual([
          "collector",
        ]);

        expect(
          manifestCalls,
        ).toBe(
          0,
        );

        expect(
          await readdir(
            current.revisionRoot,
          ),
        ).toEqual([
          "app",
        ]);
      },
    );

    it(
      "rejects provenance bytes changed after temporary manifest creation and before sibling publication",
      async () => {
        const current =
          await fixture();

        let manifestCalls =
          0;

        await expect(
          preparePortableReleaseProductionDependencies(
            {
              revisionRoot:
                current.revisionRoot,

              artifactRoot:
                current.artifactRoot,
            },
            {
              runInstall:
                successfulRunner(
                  [],
                ),

              collectInstallProvenance:
                recordingCollector(
                  [],
                ),

              createDependencyManifest:
                async dependencyRoot => {
                  manifestCalls +=
                    1;

                  const manifest =
                    await createPortableReleaseDependencyTreeManifest(
                      dependencyRoot,
                    );

                  if (
                    manifestCalls ===
                      1
                  ) {
                    await writeFile(
                      join(
                        dependencyRoot,
                        ".busybookie-install-provenance.json",
                      ),
                      serializePortableReleaseDependencyInstallProvenance(
                        createPortableReleaseDependencyInstallProvenance({
                          ...PROVENANCE_INPUT,

                          npmVersion:
                            "11.11.2",
                        }),
                      ),
                    );
                  }

                  return manifest;
                },
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Published production dependencies do not match the verified dependency manifest.",
        );

        expect(
          manifestCalls,
        ).toBe(
          2,
        );

        expect(
          await readdir(
            current.revisionRoot,
          ),
        ).toEqual([
          "app",
        ]);
      },
    );

    it(
      "default collector reads the version from the given executable with execFile and trims stdout",
      async () => {
        // Uses the running Node binary as a stand-in executable so the real
        // workstation npm is never invoked; `node --version` prints process.version.
        const current =
          await fixture();

        const collected =
          await collectPortableReleaseDependencyInstallProvenance({
            cwd:
              current.revisionRoot,

            npmExecutable:
              process.execPath,
          });

        expect(
          collected,
        ).toEqual({
          nodeVersion:
            process.version,

          npmVersion:
            process.version,

          platform:
            process.platform,

          arch:
            process.arch,
        });
      },
    );

    it(
      "default collector fails closed when the version command cannot run",
      async () => {
        const current =
          await fixture();

        await expect(
          collectPortableReleaseDependencyInstallProvenance({
            cwd:
              current.revisionRoot,

            npmExecutable:
              join(
                current.root,
                "missing-npm-executable",
              ),
          }),
        ).rejects.toThrow(
          "Portable release installation failed: npm version could not be collected for dependency-install provenance.",
        );
      },
    );

    it(
      "default collector runs the version command in the supplied cwd and fails closed when it is unavailable",
      async () => {
        const current =
          await fixture();

        // A working executable with a missing cwd can only fail if cwd is forwarded to execFile.
        await expect(
          collectPortableReleaseDependencyInstallProvenance({
            cwd:
              join(
                current.root,
                "missing-work-root",
              ),

            npmExecutable:
              process.execPath,
          }),
        ).rejects.toThrow(
          "Portable release installation failed: npm version could not be collected for dependency-install provenance.",
        );
      },
    );
  },
);
