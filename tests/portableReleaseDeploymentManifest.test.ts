import {
  describe,
  expect,
  it,
} from "vitest";

import {
  parsePortableReleaseTreeManifest,
} from "../src/deployment/portableReleaseTreeManifest.js";

const A =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const B =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function line(
  sha256: string,
  relativePath: string,
): string {
  return `${sha256} *./${relativePath}\n`;
}

describe(
  "portable release deployment whole-tree manifest",
  () => {
    it(
      "parses the packaging-authoritative sha256 *./relative/path format",
      () => {
        const parsed =
          parsePortableReleaseTreeManifest(
            Buffer.from(
              line(
                A,
                "apps/operator-console/dist/index.html",
              ) +
                line(
                  B,
                  "package.json",
                ),
              "utf8",
            ),
          );

        expect(parsed).toEqual([
          {
            sha256: A,
            relativePath:
              "apps/operator-console/dist/index.html",
          },
          {
            sha256: B,
            relativePath:
              "package.json",
          },
        ]);

        expect(
          Object.isFrozen(parsed),
        ).toBe(true);

        for (const entry of parsed) {
          expect(
            Object.isFrozen(entry),
          ).toBe(true);
        }
      },
    );

    it(
      "requires a final newline so truncated manifest bytes are never silently accepted",
      () => {
        expect(
          () =>
            parsePortableReleaseTreeManifest(
              Buffer.from(
                `${A} *./package.json`,
                "utf8",
              ),
            ),
        ).toThrow();
      },
    );

    it.each([
      "",
      `${A}  ./package.json\n`,
      `${A} *package.json\n`,
      `${A.toUpperCase()} *./package.json\n`,
      `not-a-sha *./package.json\n`,
      `${A} *./\n`,
    ])(
      "rejects malformed manifest syntax: %j",
      manifest => {
        expect(
          () =>
            parsePortableReleaseTreeManifest(
              Buffer.from(
                manifest,
                "utf8",
              ),
            ),
        ).toThrow();
      },
    );

    it.each([
      "/absolute",
      "../escape",
      "a/../escape",
      "./package.json",
      "a/./package.json",
      "a//package.json",
      "a\\package.json",
      "a/\u0000package.json",
      "a/\u001fpackage.json",
      "a/\u007fpackage.json",
    ])(
      "rejects unsafe release-relative path %j",
      relativePath => {
        expect(
          () =>
            parsePortableReleaseTreeManifest(
              Buffer.from(
                line(
                  A,
                  relativePath,
                ),
                "utf8",
              ),
            ),
        ).toThrow();
      },
    );

    it(
      "requires strictly increasing portable paths and therefore rejects duplicate paths",
      () => {
        expect(
          () =>
            parsePortableReleaseTreeManifest(
              Buffer.from(
                line(
                  A,
                  "package.json",
                ) +
                  line(
                    B,
                    "package.json",
                  ),
                "utf8",
              ),
            ),
        ).toThrow();
      },
    );

    it(
      "rejects out-of-order paths so manifest order remains canonical",
      () => {
        expect(
          () =>
            parsePortableReleaseTreeManifest(
              Buffer.from(
                line(
                  A,
                  "package.json",
                ) +
                  line(
                    B,
                    "apps/operator-console/dist/index.html",
                  ),
                "utf8",
              ),
            ),
        ).toThrow();
      },
    );

    it(
      "rejects invalid UTF-8 rather than replacing bytes",
      () => {
        expect(
          () =>
            parsePortableReleaseTreeManifest(
              Buffer.from([
                0xff,
                0xfe,
                0xfd,
                0x0a,
              ]),
            ),
        ).toThrow();
      },
    );
  },
);
