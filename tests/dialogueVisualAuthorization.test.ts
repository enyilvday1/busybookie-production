import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  dirname,
  join,
} from "node:path";

import {
  DialogueVisualAuthorizationSchema,
} from "../src/execution/dialogueVisualAuthorization.schema.js";

import {
  createDialogueVisualAuthorizationPath,
} from "../src/execution/dialogueVisualAuthorizationPath.js";

import {
  createDialogueVisualAuthorization,
} from "../src/execution/createDialogueVisualAuthorization.js";

import {
  readDialogueVisualAuthorization,
} from "../src/execution/readDialogueVisualAuthorization.js";

const temporaryDirectories:
  string[] = [];

async function makeTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-dialogue-visual-authorization-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

afterEach(
  async () => {
    while (
      temporaryDirectories.length >
      0
    ) {
      const directory =
        temporaryDirectories.pop();

      if (!directory) {
        continue;
      }

      await rm(
        directory,
        {
          recursive: true,
          force: true,
        },
      );
    }
  },
);

function authorizationInput() {
  return {
    episodeId:
      "EP02",

    shotId:
      "S02",

    purpose:
      "DIALOGUE_VISUAL_GENERATION",

    provider:
      "VEO",

    nativeAudioDisposition:
      "DISCARD_AFTER_VISUAL_GENERATION",

    dialogueAuthority:
      "EXTERNAL_VERIFIED_DIALOGUE",

    authorizationSource:
      "HUMAN_OPERATOR",
  } as const;
}

const AUTHORIZATION_ID =
  "11111111-1111-4111-8111-111111111111";

const AUTHORIZED_AT =
  "2026-10-07T19:30:00.000Z";

describe(
  "Busybookie durable dialogue-visual authorization",
  () => {
    it(
      "uses one shot-scoped authorization path beside the generic execution lifecycle",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        expect(
          createDialogueVisualAuthorizationPath(
            mediaRoot,
            "EP02",
            "S02",
          ),
        ).toBe(
          join(
            mediaRoot,
            "generated-video",
            "EP02",
            "S02",
            "EP02_S02.dialogue-visual-authorization.json",
          ),
        );
      },
    );

    it(
      "defines a strict v1 authorization receipt for visual generation while external dialogue remains authoritative",
      () => {
        const record = {
          schemaVersion:
            "1.0",

          authorizationId:
            AUTHORIZATION_ID,

          authorizedAt:
            AUTHORIZED_AT,

          status:
            "AUTHORIZED",

          ...authorizationInput(),
        } as const;

        expect(
          DialogueVisualAuthorizationSchema
            .parse(
              record,
            ),
        ).toEqual(
          record,
        );

        expect(
          DialogueVisualAuthorizationSchema
            .safeParse({
              ...record,
              purpose:
                "FULL_DIALOGUE_GENERATION",
            })
            .success,
        ).toBe(
          false,
        );

        expect(
          DialogueVisualAuthorizationSchema
            .safeParse({
              ...record,
              provider:
                "MANUAL",
            })
            .success,
        ).toBe(
          false,
        );

        expect(
          DialogueVisualAuthorizationSchema
            .safeParse({
              ...record,
              nativeAudioDisposition:
                "KEEP_NATIVE_AUDIO",
            })
            .success,
        ).toBe(
          false,
        );

        expect(
          DialogueVisualAuthorizationSchema
            .safeParse({
              ...record,
              dialogueAuthority:
                "PROVIDER_NATIVE_AUDIO",
            })
            .success,
        ).toBe(
          false,
        );

        expect(
          DialogueVisualAuthorizationSchema
            .safeParse({
              ...record,
              unexpected:
                true,
            })
            .success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "creates and reads an immutable authorization receipt bound to the exact episode shot and provider",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const created =
          await createDialogueVisualAuthorization(
            mediaRoot,
            authorizationInput(),
            {
              now:
                () =>
                  AUTHORIZED_AT,

              createAuthorizationId:
                () =>
                  AUTHORIZATION_ID,
            },
          );

        expect(
          created.authorizationPath,
        ).toBe(
          join(
            mediaRoot,
            "generated-video",
            "EP02",
            "S02",
            "EP02_S02.dialogue-visual-authorization.json",
          ),
        );

        expect(
          created.record,
        ).toEqual({
          schemaVersion:
            "1.0",

          authorizationId:
            AUTHORIZATION_ID,

          authorizedAt:
            AUTHORIZED_AT,

          status:
            "AUTHORIZED",

          ...authorizationInput(),
        });

        await expect(
          readDialogueVisualAuthorization(
            mediaRoot,
            "EP02",
            "S02",
          ),
        ).resolves.toEqual(
          created.record,
        );
      },
    );

    it(
      "rejects a second authorization write instead of overwriting durable human authorization evidence",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const first =
          await createDialogueVisualAuthorization(
            mediaRoot,
            authorizationInput(),
            {
              now:
                () =>
                  AUTHORIZED_AT,

              createAuthorizationId:
                () =>
                  AUTHORIZATION_ID,
            },
          );

        await expect(
          createDialogueVisualAuthorization(
            mediaRoot,
            authorizationInput(),
            {
              now:
                () =>
                  "2026-10-07T19:31:00.000Z",

              createAuthorizationId:
                () =>
                  "22222222-2222-4222-8222-222222222222",
            },
          ),
        ).rejects.toThrow(
          /dialogue visual authorization already exists/i,
        );

        await expect(
          readDialogueVisualAuthorization(
            mediaRoot,
            "EP02",
            "S02",
          ),
        ).resolves.toEqual(
          first.record,
        );
      },
    );

    it(
      "returns null when absent and fails closed on malformed durable authorization JSON",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await expect(
          readDialogueVisualAuthorization(
            mediaRoot,
            "EP02",
            "S02",
          ),
        ).resolves.toBeNull();

        const authorizationPath =
          createDialogueVisualAuthorizationPath(
            mediaRoot,
            "EP02",
            "S02",
          );

        await mkdir(
          dirname(
            authorizationPath,
          ),
          {
            recursive: true,
          },
        );

        await writeFile(
          authorizationPath,
          "{damaged",
          "utf8",
        );

        await expect(
          readDialogueVisualAuthorization(
            mediaRoot,
            "EP02",
            "S02",
          ),
        ).rejects.toThrow(
          /dialogue visual authorization|malformed|invalid/i,
        );
      },
    );
  },
);
