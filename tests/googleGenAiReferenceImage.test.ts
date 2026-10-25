import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  dirname,
  join,
  parse,
  resolve,
  sep,
} from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  detectGoogleGenAiReferenceImageMimeTypes,
  GoogleGenAiReferenceImageRejectedError,
  NODE_GOOGLE_GENAI_REFERENCE_IMAGE_FILE_SYSTEM,
  readGoogleGenAiReferenceImage,
  type GoogleGenAiReferenceImageFileHandle,
  type GoogleGenAiReferenceImageFileSystem,
  type GoogleGenAiReferenceImageMimeType,
  type GoogleGenAiReferenceImageRejectionCode,
  type GoogleGenAiReferenceImageStats,
} from "../src/googleGenai/assets/readGoogleGenAiReferenceImage.js";

const MAX_BYTES =
  10485760;

const PNG_SIGNATURE =
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const temporaryDirectories:
  string[] = [];

afterEach(
  async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map(
          (directory) =>
            rm(
              directory,
              {
                recursive:
                  true,

                force:
                  true,
              },
            ),
        ),
    );
  },
);

async function makeMediaRoot():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-google-reference-image-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  await mkdir(
    join(
      directory,
      "references",
    ),
    {
      recursive:
        true,
    },
  );

  return directory;
}

async function writeFileAt(
  path:
    string,
  bytes:
    Buffer,
): Promise<string> {
  await mkdir(
    dirname(
      path,
    ),
    {
      recursive:
        true,
    },
  );

  await writeFile(
    path,
    bytes,
  );

  return path;
}

function pngOfSize(
  size:
    number,
): Buffer {
  const bytes =
    Buffer.alloc(
      size,
    );

  PNG_SIGNATURE.copy(
    bytes,
  );

  return bytes;
}

async function expectRejected(
  attempt:
    Promise<unknown>,
  code:
    GoogleGenAiReferenceImageRejectionCode,
): Promise<void> {
  let caught:
    unknown;

  try {
    await attempt;
  } catch (error) {
    caught =
      error;
  }

  expect(
    caught,
  ).toBeInstanceOf(
    GoogleGenAiReferenceImageRejectedError,
  );

  expect(
    (
      caught as GoogleGenAiReferenceImageRejectedError
    ).code,
  ).toBe(
    code,
  );
}

/**
 * A small, coherent virtual filesystem for race tests. Links resolve like
 * symlinks/junctions, open handles stay bound to the inode they opened,
 * ancestors of any node exist implicitly as directories, and mutations are
 * injected at an exact point of the production call sequence:
 *   (before|after, operation, nth occurrence of that operation).
 */
type VirtualNode =
  | { readonly kind: "dir" }
  | { readonly kind: "link"; readonly target: string }
  | { readonly kind: "file"; readonly ino: bigint; content: Buffer; nlink: bigint };

type VirtualOperation =
  | "realpath"
  | "lstat"
  | "open"
  | "handle.stat"
  | "handle.read";

type VirtualHook = {
  readonly when: "before" | "after";
  readonly operation: VirtualOperation;
  readonly occurrence: number;
  readonly mutate: () => void;
};

const VIRTUAL_DEV =
  7n;

class VirtualFileSystem {
  readonly nodes =
    new Map<string, VirtualNode>();

  readonly log: string[] = [];

  readonly reads: Array<{ length: number; position: number }> = [];

  opened =
    0;

  closed =
    0;

  private readonly hooks: VirtualHook[] = [];

  private readonly counts =
    new Map<VirtualOperation, number>();

  dir(
    path: string,
  ): this {
    this.nodes.set(
      resolve(path),
      { kind: "dir" },
    );

    return this;
  }

  file(
    path: string,
    content: Buffer,
    ino: bigint,
    nlink = 1n,
  ): this {
    this.nodes.set(
      resolve(path),
      { kind: "file", ino, content, nlink },
    );

    return this;
  }

  link(
    path: string,
    target: string,
  ): this {
    this.nodes.set(
      resolve(path),
      { kind: "link", target: resolve(target) },
    );

    return this;
  }

  alias(
    path: string,
    existing: string,
  ): this {
    const node =
      this.nodes.get(
        resolve(existing),
      );

    if (!node) {
      throw new Error(`No virtual node at ${existing}.`);
    }

    this.nodes.set(
      resolve(path),
      node,
    );

    return this;
  }

  fileNode(
    path: string,
  ): Extract<VirtualNode, { kind: "file" }> {
    const node =
      this.nodes.get(
        resolve(path),
      );

    if (node?.kind !== "file") {
      throw new Error(`No virtual file at ${path}.`);
    }

    return node;
  }

  on(
    when: "before" | "after",
    operation: VirtualOperation,
    occurrence: number,
    mutate: () => void,
  ): this {
    this.hooks.push({ when, operation, occurrence, mutate });

    return this;
  }

  private begin(
    operation: VirtualOperation,
  ): number {
    const occurrence =
      (this.counts.get(operation) ?? 0) + 1;

    this.counts.set(
      operation,
      occurrence,
    );

    this.log.push(
      operation,
    );

    this.fire(
      "before",
      operation,
      occurrence,
    );

    return occurrence;
  }

  private fire(
    when: "before" | "after",
    operation: VirtualOperation,
    occurrence: number,
  ): void {
    for (const hook of this.hooks) {
      if (
        hook.when === when &&
        hook.operation === operation &&
        hook.occurrence === occurrence
      ) {
        hook.mutate();
      }
    }
  }

  private split(
    path: string,
  ): { root: string; parts: string[] } {
    const absolute =
      resolve(path);

    const root =
      parse(absolute).root;

    return {
      root,
      parts:
        absolute
          .slice(root.length)
          .split(sep)
          .filter(Boolean),
    };
  }

  private walk(
    path: string,
    followFinal: boolean,
  ): string {
    let {
      root: current,
      parts,
    } =
      this.split(path);

    let index =
      0;

    let hops =
      0;

    while (index < parts.length) {
      const next =
        join(
          current,
          parts[index] ?? "",
        );

      const node =
        this.nodes.get(next);

      const isFinal =
        index === parts.length - 1;

      if (
        node?.kind === "link" &&
        (!isFinal || followFinal)
      ) {
        hops += 1;

        if (hops > 32) {
          throw Object.assign(new Error("ELOOP"), { code: "ELOOP" });
        }

        const target =
          this.split(node.target);

        current =
          target.root;

        parts = [
          ...target.parts,
          ...parts.slice(index + 1),
        ];

        index = 0;

        continue;
      }

      current =
        next;

      index += 1;
    }

    return current;
  }

  private nodeAt(
    path: string,
  ): VirtualNode | undefined {
    const node =
      this.nodes.get(path);

    if (node) {
      return node;
    }

    for (const key of this.nodes.keys()) {
      if (key.startsWith(`${path}${sep}`)) {
        return { kind: "dir" };
      }
    }

    return undefined;
  }

  private stats(
    node: VirtualNode,
  ): GoogleGenAiReferenceImageStats {
    return {
      isFile: () => node.kind === "file",
      isDirectory: () => node.kind === "dir",
      isSymbolicLink: () => node.kind === "link",
      size: node.kind === "file" ? BigInt(node.content.length) : 0n,
      dev: VIRTUAL_DEV,
      ino: node.kind === "file" ? node.ino : 1n,
      nlink: node.kind === "file" ? node.nlink : 1n,
    };
  }

  private missing(
    path: string,
  ): Error {
    return Object.assign(
      new Error(`ENOENT: ${path}`),
      { code: "ENOENT" },
    );
  }

  readonly fileSystem: GoogleGenAiReferenceImageFileSystem = {
    realpath: async (path) => {
      const occurrence =
        this.begin("realpath");

      const real =
        this.walk(path, true);

      const exists =
        this.nodeAt(real) !== undefined;

      this.fire("after", "realpath", occurrence);

      if (!exists) {
        throw this.missing(path);
      }

      return real;
    },

    lstat: async (path) => {
      const occurrence =
        this.begin("lstat");

      const node =
        this.nodeAt(
          this.walk(path, false),
        );

      this.fire("after", "lstat", occurrence);

      if (!node) {
        throw this.missing(path);
      }

      return this.stats(node);
    },

    open: async (path) => {
      const occurrence =
        this.begin("open");

      const node =
        this.nodeAt(
          this.walk(path, true),
        );

      if (!node) {
        throw this.missing(path);
      }

      this.opened += 1;

      // The handle is bound to the node (inode) opened now.
      const handle: GoogleGenAiReferenceImageFileHandle = {
        stat: async () => {
          const statOccurrence =
            this.begin("handle.stat");

          const result =
            this.stats(node);

          this.fire("after", "handle.stat", statOccurrence);

          return result;
        },

        read: async (buffer, offset, length, position) => {
          const readOccurrence =
            this.begin("handle.read");

          this.reads.push({ length, position });

          if (node.kind !== "file") {
            throw Object.assign(new Error("EISDIR"), { code: "EISDIR" });
          }

          const chunk =
            node.content.subarray(
              position,
              position + length,
            );

          buffer.set(
            chunk,
            offset,
          );

          this.fire("after", "handle.read", readOccurrence);

          return { bytesRead: chunk.length };
        },

        close: async () => {
          this.closed += 1;
        },
      };

      this.fire("after", "open", occurrence);

      return handle;
    },
  };
}

const VFS_MEDIA_ROOT =
  join(tmpdir(), "busybookie-virtual-media");

const VFS_REFERENCES =
  join(VFS_MEDIA_ROOT, "references");

const VFS_EP92 =
  join(VFS_REFERENCES, "EP92");

const VFS_IMAGE =
  join(VFS_EP92, "S01", "reference.png");

const VFS_OUTSIDE =
  join(tmpdir(), "busybookie-virtual-outside");

const VFS_OUTSIDE_IMAGE =
  join(VFS_OUTSIDE, "S01", "reference.png");

const VFS_ALT_ROOT =
  join(tmpdir(), "busybookie-virtual-alt-references");

const VFS_MIRROR =
  join(VFS_REFERENCES, "mirror");

const VFS_INSIDE_OTHER =
  join(VFS_REFERENCES, "other.png");

const IMAGE_INO =
  42n;

const OUTSIDE_INO =
  99n;

/**
 * Initial state for every race test:
 *   <references>/EP92/S01/reference.png   inode 42, nlink 1 (valid PNG)
 *   <outside>/S01/reference.png           inode 99 (outside the root)
 */
function virtualScenario(
  imageBytes: Buffer =
    pngOfSize(64),
): VirtualFileSystem {
  return new VirtualFileSystem()
    .dir(VFS_REFERENCES)
    .dir(VFS_EP92)
    .dir(join(VFS_EP92, "S01"))
    .file(VFS_IMAGE, imageBytes, IMAGE_INO)
    .dir(VFS_OUTSIDE)
    .dir(join(VFS_OUTSIDE, "S01"))
    .file(VFS_OUTSIDE_IMAGE, pngOfSize(64), OUTSIDE_INO);
}

function readVirtual(
  vfs: VirtualFileSystem,
  maxBytes =
    MAX_BYTES,
) {
  return readGoogleGenAiReferenceImage({
    mediaRoot:
      VFS_MEDIA_ROOT,

    sourceImagePath:
      VFS_IMAGE,

    expectedMimeType:
      "image/png",

    maxBytes,

    fileSystem:
      vfs.fileSystem,
  });
}

/**
 * Production operation order for a successful read of a file two
 * directories below the root (EP92/S01/reference.png): each resolve stage is
 * realpath(root), realpath(candidate), then 3 canonical + 3 lexical lstats.
 */
const RESOLVE_STAGE = [
  "realpath",
  "realpath",
  "lstat",
  "lstat",
  "lstat",
  "lstat",
  "lstat",
  "lstat",
] as const;

const SUCCESSFUL_OPERATION_ORDER = [
  ...RESOLVE_STAGE,
  "open",
  "handle.stat",
  ...RESOLVE_STAGE,
  "handle.read",
  "handle.read",
  "handle.stat",
  ...RESOLVE_STAGE,
] as const;

describe(
  "Busybookie Google GenAI secure reference-image reader (B4U6)",
  () => {
    describe(
      "real filesystem",
      () => {
        it(
          "returns the exact validated bytes, canonical path and MIME for a valid image",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            const bytes =
              pngOfSize(
                128,
              );

            const path =
              await writeFileAt(
                join(
                  mediaRoot,
                  "references",
                  "EP92",
                  "S01",
                  "reference.png",
                ),
                bytes,
              );

            const image =
              await readGoogleGenAiReferenceImage({
                mediaRoot,
                sourceImagePath:
                  path,
                expectedMimeType:
                  "image/png",
                maxBytes:
                  MAX_BYTES,
              });

            expect(
              image.bytes.equals(
                bytes,
              ),
            ).toBe(
              true,
            );

            expect(
              image.byteLength,
            ).toBe(
              128,
            );

            expect(
              image.mimeType,
            ).toBe(
              "image/png",
            );

            expect(
              image.canonicalPath,
            ).toBe(
              await realpath(
                path,
              ),
            );

            expect(
              Object.isFrozen(
                image,
              ),
            ).toBe(
              true,
            );
          },
        );

        it(
          "accepts an image of exactly 10 MiB",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            const path =
              await writeFileAt(
                join(
                  mediaRoot,
                  "references",
                  "exact.png",
                ),
                pngOfSize(
                  MAX_BYTES,
                ),
              );

            const image =
              await readGoogleGenAiReferenceImage({
                mediaRoot,
                sourceImagePath:
                  path,
                expectedMimeType:
                  "image/png",
                maxBytes:
                  MAX_BYTES,
              });

            expect(
              image.byteLength,
            ).toBe(
              MAX_BYTES,
            );
          },
        );

        it(
          "rejects an image of 10 MiB + 1 byte",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            const path =
              await writeFileAt(
                join(
                  mediaRoot,
                  "references",
                  "over.png",
                ),
                pngOfSize(
                  MAX_BYTES + 1,
                ),
              );

            await expectRejected(
              readGoogleGenAiReferenceImage({
                mediaRoot,
                sourceImagePath:
                  path,
                expectedMimeType:
                  "image/png",
                maxBytes:
                  MAX_BYTES,
              }),
              "TOO_LARGE",
            );
          },
        );

        it(
          "rejects an empty file",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await expectRejected(
              readGoogleGenAiReferenceImage({
                mediaRoot,
                sourceImagePath:
                  await writeFileAt(
                    join(
                      mediaRoot,
                      "references",
                      "empty.png",
                    ),
                    Buffer.alloc(0),
                  ),
                expectedMimeType:
                  "image/png",
                maxBytes:
                  MAX_BYTES,
              }),
              "EMPTY",
            );
          },
        );

        it(
          "rejects a directory",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            const directory =
              join(
                mediaRoot,
                "references",
                "folder.png",
              );

            await mkdir(
              directory,
            );

            await expectRejected(
              readGoogleGenAiReferenceImage({
                mediaRoot,
                sourceImagePath:
                  directory,
                expectedMimeType:
                  "image/png",
                maxBytes:
                  MAX_BYTES,
              }),
              "NOT_REGULAR_FILE",
            );
          },
        );

        it(
          "rejects a missing file as unreadable",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await expectRejected(
              readGoogleGenAiReferenceImage({
                mediaRoot,
                sourceImagePath:
                  join(
                    mediaRoot,
                    "references",
                    "missing.png",
                  ),
                expectedMimeType:
                  "image/png",
                maxBytes:
                  MAX_BYTES,
              }),
              "UNREADABLE",
            );
          },
        );

        it(
          "rejects a file outside the references root",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await expectRejected(
              readGoogleGenAiReferenceImage({
                mediaRoot,
                sourceImagePath:
                  await writeFileAt(
                    join(
                      mediaRoot,
                      "generated-video",
                      "reference.png",
                    ),
                    pngOfSize(
                      32,
                    ),
                  ),
                expectedMimeType:
                  "image/png",
                maxBytes:
                  MAX_BYTES,
              }),
              "PATH_ESCAPE",
            );
          },
        );

        it(
          "rejects a lexical-prefix sibling such as references2",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await expectRejected(
              readGoogleGenAiReferenceImage({
                mediaRoot,
                sourceImagePath:
                  await writeFileAt(
                    join(
                      mediaRoot,
                      "references2",
                      "reference.png",
                    ),
                    pngOfSize(
                      32,
                    ),
                  ),
                expectedMimeType:
                  "image/png",
                maxBytes:
                  MAX_BYTES,
              }),
              "PATH_ESCAPE",
            );
          },
        );

        it(
          "rejects the references root itself",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await expectRejected(
              readGoogleGenAiReferenceImage({
                mediaRoot,
                sourceImagePath:
                  join(
                    mediaRoot,
                    "references",
                  ),
                expectedMimeType:
                  "image/png",
                maxBytes:
                  MAX_BYTES,
              }),
              "PATH_ESCAPE",
            );
          },
        );

        it(
          "rejects an image reached through a directory junction/symlink that escapes the root",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            const outside =
              await mkdtemp(
                join(
                  tmpdir(),
                  "busybookie-google-reference-outside-",
                ),
              );

            temporaryDirectories.push(
              outside,
            );

            await writeFileAt(
              join(
                outside,
                "secret.png",
              ),
              pngOfSize(
                32,
              ),
            );

            const linkDirectory =
              join(
                mediaRoot,
                "references",
                "linked",
              );

            // "junction" needs no privilege on Windows; POSIX ignores the
            // type and creates a directory symlink.
            await symlink(
              outside,
              linkDirectory,
              "junction",
            );

            const lexicallyInside =
              join(
                linkDirectory,
                "secret.png",
              );

            await expectRejected(
              readGoogleGenAiReferenceImage({
                mediaRoot,
                sourceImagePath:
                  lexicallyInside,
                expectedMimeType:
                  "image/png",
                maxBytes:
                  MAX_BYTES,
              }),
              "PATH_ESCAPE",
            );
          },
        );

        it(
          "rejects unsupported content and extension/content mismatches",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await expectRejected(
              readGoogleGenAiReferenceImage({
                mediaRoot,
                sourceImagePath:
                  await writeFileAt(
                    join(
                      mediaRoot,
                      "references",
                      "text.png",
                    ),
                    Buffer.from(
                      "plain text, not an image",
                      "utf8",
                    ),
                  ),
                expectedMimeType:
                  "image/png",
                maxBytes:
                  MAX_BYTES,
              }),
              "UNSUPPORTED_SIGNATURE",
            );

            await expectRejected(
              readGoogleGenAiReferenceImage({
                mediaRoot,
                sourceImagePath:
                  await writeFileAt(
                    join(
                      mediaRoot,
                      "references",
                      "png-content.jpg",
                    ),
                    pngOfSize(
                      32,
                    ),
                  ),
                expectedMimeType:
                  "image/jpeg",
                maxBytes:
                  MAX_BYTES,
              }),
              "SIGNATURE_MIME_MISMATCH",
            );
          },
        );

        it(
          "rejects a pre-existing in-root junction/symlink component even though it resolves inside the root",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await writeFileAt(
              join(
                mediaRoot,
                "references",
                "EP92",
                "S01",
                "reference.png",
              ),
              pngOfSize(
                32,
              ),
            );

            // references/alias -> references/EP92 (stays inside the root)
            await symlink(
              join(
                mediaRoot,
                "references",
                "EP92",
              ),
              join(
                mediaRoot,
                "references",
                "alias",
              ),
              "junction",
            );

            await expectRejected(
              readGoogleGenAiReferenceImage({
                mediaRoot,
                sourceImagePath:
                  join(
                    mediaRoot,
                    "references",
                    "alias",
                    "S01",
                    "reference.png",
                  ),
                expectedMimeType:
                  "image/png",
                maxBytes:
                  MAX_BYTES,
              }),
              "LINK_NOT_ALLOWED",
            );
          },
        );

        it(
          "rejects an in-root file that is a hard link to a file outside the root (nlink == 2)",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            const outside =
              await mkdtemp(
                join(
                  tmpdir(),
                  "busybookie-google-reference-outside-",
                ),
              );

            temporaryDirectories.push(
              outside,
            );

            const outsideFile =
              await writeFileAt(
                join(
                  outside,
                  "secret.png",
                ),
                pngOfSize(
                  32,
                ),
              );

            const inRoot =
              join(
                mediaRoot,
                "references",
                "hard-linked.png",
              );

            await link(
              outsideFile,
              inRoot,
            );

            await expectRejected(
              readGoogleGenAiReferenceImage({
                mediaRoot,
                sourceImagePath:
                  inRoot,
                expectedMimeType:
                  "image/png",
                maxBytes:
                  MAX_BYTES,
              }),
              "HARD_LINK_NOT_ALLOWED",
            );
          },
        );
      },
    );

    describe(
      "virtual filesystem: production operation order and race points (operator-only threat model)",
      () => {
        // These tests model single, deterministic mutations at named points of
        // the production sequence. They do not claim protection against a
        // hostile process toggling the namespace between every operation.

        it(
          "reads a stable in-root image with the exact production operation order",
          async () => {
            const vfs =
              virtualScenario();

            const image =
              await readVirtual(
                vfs,
              );

            expect(
              image.byteLength,
            ).toBe(
              64,
            );

            expect(
              image.canonicalPath,
            ).toBe(
              VFS_IMAGE,
            );

            expect(
              vfs.log,
            ).toEqual([
              ...SUCCESSFUL_OPERATION_ORDER,
            ]);

            expect(
              vfs.reads,
            ).toEqual([
              {
                length:
                  64,

                position:
                  0,
              },
              {
                length:
                  1,

                position:
                  64,
              },
            ]);

            expect(
              vfs.closed,
            ).toBe(
              1,
            );
          },
        );

        it(
          "rejects a parent directory swapped to an outside junction after initial canonicalisation (B4U7 D1 race)",
          async () => {
            // initial: EP92 is a plain directory inside the root
            // mutation: after realpath #2 (candidate canonicalised, inside)
            // post-mutation: EP92 -> <outside>, whose S01/reference.png is a
            //   regular single-link file; lstat(candidate) and open() would
            //   both reach the outside file with matching identity
            // expected: the pre-open component walk sees the junction
            const vfs =
              virtualScenario()
                .on("after", "realpath", 2, () => {
                  vfs.link(VFS_EP92, VFS_OUTSIDE);
                });

            await expectRejected(
              readVirtual(
                vfs,
              ),
              "LINK_NOT_ALLOWED",
            );

            expect(
              vfs.opened,
            ).toBe(
              0,
            );
          },
        );

        it(
          "rejects a final file replaced after the pre-open path walk and before open (identity race)",
          async () => {
            // mutation: before open #1, reference.png becomes a different inode
            // expected: open-handle identity != validated path identity
            const vfs =
              virtualScenario()
                .on("before", "open", 1, () => {
                  vfs.file(VFS_IMAGE, pngOfSize(64), 77n);
                });

            await expectRejected(
              readVirtual(
                vfs,
              ),
              "FILE_IDENTITY_CHANGED",
            );

            expect(
              vfs.reads,
            ).toEqual(
              [],
            );

            expect(
              vfs.closed,
            ).toBe(
              1,
            );
          },
        );

        it(
          "rejects a references root that canonicalises elsewhere after open",
          async () => {
            // mutation: after open #1, <references> becomes a link to an
            //   alternative root that holds the SAME opened inode
            // expected: post-open root != initial canonical root
            const vfs =
              virtualScenario();

            vfs
              .dir(VFS_ALT_ROOT)
              .dir(join(VFS_ALT_ROOT, "EP92"))
              .dir(join(VFS_ALT_ROOT, "EP92", "S01"))
              .alias(join(VFS_ALT_ROOT, "EP92", "S01", "reference.png"), VFS_IMAGE)
              .on("after", "open", 1, () => {
                vfs.link(VFS_REFERENCES, VFS_ALT_ROOT);
              });

            await expectRejected(
              readVirtual(
                vfs,
              ),
              "ROOT_CHANGED",
            );

            expect(
              vfs.reads,
            ).toEqual(
              [],
            );
          },
        );

        it(
          "rejects a candidate that canonicalises outside the original root after open",
          async () => {
            // mutation: before realpath #4 (post-open candidate), the final
            //   component becomes a link to the outside file
            // expected: post-open containment in the INITIAL root fails
            const vfs =
              virtualScenario()
                .on("before", "realpath", 4, () => {
                  vfs.link(VFS_IMAGE, VFS_OUTSIDE_IMAGE);
                });

            await expectRejected(
              readVirtual(
                vfs,
              ),
              "PATH_ESCAPE",
            );

            expect(
              vfs.reads,
            ).toEqual(
              [],
            );
          },
        );

        it(
          "rejects a path that names a different inode than the open handle after open",
          async () => {
            // mutation: after open #1, reference.png is replaced by inode 77
            //   (still a regular, single-link, in-root file)
            // expected: post-open path identity != open-handle identity
            const vfs =
              virtualScenario()
                .on("after", "open", 1, () => {
                  vfs.file(VFS_IMAGE, pngOfSize(64), 77n);
                });

            await expectRejected(
              readVirtual(
                vfs,
              ),
              "FILE_IDENTITY_CHANGED",
            );

            expect(
              vfs.reads,
            ).toEqual(
              [],
            );
          },
        );

        it(
          "rejects a path component that becomes a junction after open, even one pointing inside the root",
          async () => {
            // mutation: after open #1, EP92 -> <references>/mirror, which holds
            //   the SAME opened inode at S01/reference.png
            // expected: the post-open lexical component walk sees the junction
            const vfs =
              virtualScenario();

            vfs
              .dir(VFS_MIRROR)
              .dir(join(VFS_MIRROR, "S01"))
              .alias(join(VFS_MIRROR, "S01", "reference.png"), VFS_IMAGE)
              .on("after", "open", 1, () => {
                vfs.link(VFS_EP92, VFS_MIRROR);
              });

            await expectRejected(
              readVirtual(
                vfs,
              ),
              "LINK_NOT_ALLOWED",
            );

            expect(
              vfs.reads,
            ).toEqual(
              [],
            );
          },
        );

        it(
          "rejects a references root that changes after the bounded read and discards the bytes",
          async () => {
            // mutation: after handle.read #2 (EOF probe), <references> becomes a
            //   link to an alternative root holding the same inode
            // expected: post-read root != initial canonical root; nothing returned
            const vfs =
              virtualScenario();

            vfs
              .dir(VFS_ALT_ROOT)
              .dir(join(VFS_ALT_ROOT, "EP92"))
              .dir(join(VFS_ALT_ROOT, "EP92", "S01"))
              .alias(join(VFS_ALT_ROOT, "EP92", "S01", "reference.png"), VFS_IMAGE)
              .on("after", "handle.read", 2, () => {
                vfs.link(VFS_REFERENCES, VFS_ALT_ROOT);
              });

            await expectRejected(
              readVirtual(
                vfs,
              ),
              "ROOT_CHANGED",
            );

            expect(
              vfs.reads,
            ).toHaveLength(
              2,
            );

            expect(
              vfs.closed,
            ).toBe(
              1,
            );
          },
        );

        it(
          "rejects a candidate that canonicalises to a different in-root path after the read",
          async () => {
            // mutation: around realpath #6 (post-read candidate) the final
            //   component is briefly a link to <references>/other.png (same
            //   inode) and is restored before the component walks
            // expected: post-read canonical path != validated canonical path
            const vfs =
              virtualScenario();

            const original =
              vfs.fileNode(
                VFS_IMAGE,
              );

            vfs
              .alias(VFS_INSIDE_OTHER, VFS_IMAGE)
              .on("before", "realpath", 6, () => {
                vfs.link(VFS_IMAGE, VFS_INSIDE_OTHER);
              })
              .on("after", "realpath", 6, () => {
                vfs.nodes.set(resolve(VFS_IMAGE), original);
              });

            await expectRejected(
              readVirtual(
                vfs,
              ),
              "PATH_CHANGED",
            );
          },
        );

        it(
          "rejects a path that names a different inode than the open handle after the read",
          async () => {
            // mutation: after handle.read #2, reference.png becomes inode 77
            // expected: post-read path identity != open-handle identity
            const vfs =
              virtualScenario()
                .on("after", "handle.read", 2, () => {
                  vfs.file(VFS_IMAGE, pngOfSize(64), 77n);
                });

            await expectRejected(
              readVirtual(
                vfs,
              ),
              "FILE_IDENTITY_CHANGED",
            );
          },
        );

        it(
          "rejects a hard-link-ambiguous file (nlink 2) before opening it",
          async () => {
            const vfs =
              virtualScenario();

            vfs.fileNode(VFS_IMAGE).nlink =
              2n;

            await expectRejected(
              readVirtual(
                vfs,
              ),
              "HARD_LINK_NOT_ALLOWED",
            );

            expect(
              vfs.opened,
            ).toBe(
              0,
            );
          },
        );

        it(
          "rejects a hard link created after the pre-open walk (open-handle nlink check)",
          async () => {
            // mutation: before open #1, a second name for inode 42 appears
            // expected: the open handle reports nlink 2
            const vfs =
              virtualScenario()
                .on("before", "open", 1, () => {
                  vfs.fileNode(VFS_IMAGE).nlink = 2n;
                });

            await expectRejected(
              readVirtual(
                vfs,
              ),
              "HARD_LINK_NOT_ALLOWED",
            );

            expect(
              vfs.reads,
            ).toEqual(
              [],
            );
          },
        );

        it(
          "rejects a pre-existing final-component link that resolves inside the root, without opening",
          async () => {
            const vfs =
              virtualScenario();

            vfs
              .file(VFS_INSIDE_OTHER, pngOfSize(64), 55n)
              .link(VFS_IMAGE, VFS_INSIDE_OTHER);

            await expectRejected(
              readVirtual(
                vfs,
              ),
              "LINK_NOT_ALLOWED",
            );

            expect(
              vfs.opened,
            ).toBe(
              0,
            );
          },
        );

        it(
          "rejects a pre-existing link to an outside file as an escape, without opening",
          async () => {
            const vfs =
              virtualScenario();

            vfs.link(VFS_IMAGE, VFS_OUTSIDE_IMAGE);

            await expectRejected(
              readVirtual(
                vfs,
              ),
              "PATH_ESCAPE",
            );

            expect(
              vfs.opened,
            ).toBe(
              0,
            );
          },
        );

        it(
          "rejects a directory at the image path and a directory opened in place of the file",
          async () => {
            const asDirectory =
              virtualScenario();

            asDirectory.dir(VFS_IMAGE);

            await expectRejected(
              readVirtual(
                asDirectory,
              ),
              "NOT_REGULAR_FILE",
            );

            const swappedToDirectory =
              virtualScenario();

            swappedToDirectory.on("before", "open", 1, () => {
              swappedToDirectory.dir(VFS_IMAGE);
            });

            await expectRejected(
              readVirtual(
                swappedToDirectory,
              ),
              "NOT_REGULAR_FILE",
            );

            expect(
              swappedToDirectory.reads,
            ).toEqual(
              [],
            );

            expect(
              swappedToDirectory.closed,
            ).toBe(
              1,
            );
          },
        );

        it(
          "rejects an oversized file at the open handle before reading any byte",
          async () => {
            const vfs =
              virtualScenario(
                pngOfSize(
                  MAX_BYTES + 1,
                ),
              );

            await expectRejected(
              readVirtual(
                vfs,
              ),
              "TOO_LARGE",
            );

            expect(
              vfs.reads,
            ).toEqual(
              [],
            );

            expect(
              vfs.closed,
            ).toBe(
              1,
            );
          },
        );

        it(
          "rejects growth beyond the validated size during the read",
          async () => {
            // mutation: after handle.read #1, the opened inode gains a byte
            const vfs =
              virtualScenario()
                .on("after", "handle.read", 1, () => {
                  const node = vfs.fileNode(VFS_IMAGE);
                  node.content = Buffer.concat([node.content, Buffer.from([0])]);
                });

            await expectRejected(
              readVirtual(
                vfs,
              ),
              "READ_INCONSISTENT",
            );
          },
        );

        it(
          "rejects a file that shrinks after the handle size was validated",
          async () => {
            // mutation: after handle.stat #1, the opened inode loses bytes
            const vfs =
              virtualScenario()
                .on("after", "handle.stat", 1, () => {
                  const node = vfs.fileNode(VFS_IMAGE);
                  node.content = node.content.subarray(0, 32);
                });

            await expectRejected(
              readVirtual(
                vfs,
              ),
              "READ_INCONSISTENT",
            );
          },
        );

        it(
          "rejects a size change between the EOF probe and the final handle stat",
          async () => {
            // mutation: after handle.read #2 (probe returned 0), the inode grows
            const vfs =
              virtualScenario()
                .on("after", "handle.read", 2, () => {
                  const node = vfs.fileNode(VFS_IMAGE);
                  node.content = Buffer.concat([node.content, Buffer.from([0])]);
                });

            await expectRejected(
              readVirtual(
                vfs,
              ),
              "READ_INCONSISTENT",
            );
          },
        );

        it.each([
          0,
          -1,
          Number.NaN,
          1.5,
        ])(
          "rejects an invalid maximum size %s before touching the filesystem",
          async (maxBytes) => {
            const vfs =
              virtualScenario();

            await expectRejected(
              readVirtual(
                vfs,
                maxBytes,
              ),
              "INVALID_LIMIT",
            );

            expect(
              vfs.log,
            ).toEqual(
              [],
            );
          },
        );

        it(
          "uses node fs/promises with bigint stats by default",
          () => {
            expect(
              Object.keys(
                NODE_GOOGLE_GENAI_REFERENCE_IMAGE_FILE_SYSTEM,
              ).sort(),
            ).toEqual([
              "lstat",
              "open",
              "realpath",
            ]);
          },
        );
      },
    );

    describe(
      "magic-byte detection (existing MIME set, no widening)",
      () => {
        it.each([
          ["image/png", PNG_SIGNATURE],
          ["image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xdb])],
          ["image/webp", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8L")])],
          ["image/gif", Buffer.from("GIF87a----")],
          ["image/bmp", Buffer.concat([Buffer.from("BM"), Buffer.alloc(30)])],
          ["image/tiff", Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8])],
          ["image/heic", Buffer.concat([Buffer.from([0, 0, 0, 0x10]), Buffer.from("ftypheic"), Buffer.alloc(4)])],
          ["image/heif", Buffer.concat([Buffer.from([0, 0, 0, 0x10]), Buffer.from("ftypmif1"), Buffer.alloc(4)])],
        ] as const)(
          "detects %s",
          (
            mimeType,
            bytes,
          ) => {
            expect(
              detectGoogleGenAiReferenceImageMimeTypes(
                bytes,
              ),
            ).toContain(
              mimeType,
            );
          },
        );

        it(
          "detects HEIC from a compatible brand behind a mif1 major brand",
          () => {
            expect(
              detectGoogleGenAiReferenceImageMimeTypes(
                Buffer.concat([
                  Buffer.from([0, 0, 0, 0x14]),
                  Buffer.from("ftypmif1"),
                  Buffer.alloc(4),
                  Buffer.from("heic"),
                ]),
              ),
            ).toEqual([
              "image/heic",
              "image/heif",
            ]);
          },
        );

        it.each([
          ["svg text", Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"/>")],
          ["truncated png", PNG_SIGNATURE.subarray(0, 4)],
          ["short bmp", Buffer.from("BM")],
          ["avif ftyp", Buffer.concat([Buffer.from([0, 0, 0, 0x10]), Buffer.from("ftypavif"), Buffer.alloc(4)])],
          ["mp4 ftyp", Buffer.concat([Buffer.from([0, 0, 0, 0x10]), Buffer.from("ftypisom"), Buffer.alloc(4)])],
          ["oversized ftyp box", Buffer.concat([Buffer.from([0, 0, 0, 0x40]), Buffer.from("ftypheic"), Buffer.alloc(4)])],
          ["empty", Buffer.alloc(0)],
        ])(
          "rejects %s",
          (
            _label,
            bytes,
          ) => {
            expect(
              detectGoogleGenAiReferenceImageMimeTypes(
                bytes,
              ),
            ).toEqual(
              [],
            );
          },
        );
      },
    );

    describe(
      "static boundary",
      () => {
        it(
          "contains no unbounded whole-file read and base64-encodes only in the adapter after validation",
          async () => {
            const reader =
              await readFile(
                join(
                  process.cwd(),
                  "src/googleGenai/assets/readGoogleGenAiReferenceImage.ts",
                ),
                "utf8",
              );

            expect(
              reader,
            ).not.toMatch(
              /\breadFile\b|createReadStream|readFileSync|toString\(\s*["']base64["']|process\.env|fetch\s*\(/,
            );

            const adapter =
              await readFile(
                join(
                  process.cwd(),
                  "src/execution/providers/submitGoogleGenAiSingleShot.ts",
                ),
                "utf8",
              );

            expect(
              adapter,
            ).not.toMatch(
              /\breadFile\b|createReadStream|readFileSync/,
            );

            const readAt =
              adapter.indexOf(
                "await readGoogleGenAiReferenceImage(",
              );

            const base64At =
              adapter.indexOf(
                "referenceImage.bytes.toString(",
              );

            expect(
              readAt,
            ).toBeGreaterThan(
              0,
            );

            expect(
              base64At,
            ).toBeGreaterThan(
              readAt,
            );

            expect(
              adapter.match(
                /toString\(\s*["']base64["']/g,
              ) ?? [],
            ).toHaveLength(
              1,
            );
          },
        );

        it(
          "leaves the shared Runway/Veo reference-path helper untouched by Google imports",
          async () => {
            const shared =
              await readFile(
                join(
                  process.cwd(),
                  "src/execution/providers/referenceImagePath.ts",
                ),
                "utf8",
              );

            expect(
              shared,
            ).not.toMatch(
              /googleGenai|GoogleGenAi|realpath|lstat/,
            );
          },
        );
      },
    );
  },
);
