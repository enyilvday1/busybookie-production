import {
  EpisodeManifestSchema,
  ShotSchema,
} from "../../schemas/episodeManifest.schema.js";

import {
  VisualEvidenceAdoptionSha256Schema,
} from "../visualEvidenceAdoption.schema.js";

export type VisualEvidenceAdoptionCliOptions =
  Readonly<{
    episodeId:
      string;

    shotId:
      string;

    expectedManifestRawSha256:
      string;

    expectedObservationSha256:
      string;

    confirmAdoption:
      true;
  }>;

const VALUE_FLAGS =
  Object.freeze([
    "--episode",
    "--shot",
    "--expected-manifest-sha256",
    "--expected-observation-sha256",
  ] as const);

type ValueFlag =
  typeof VALUE_FLAGS[number];

const CONFIRM_FLAG =
  "--confirm-adoption";

function isValueFlag(
  value:
    string,
): value is ValueFlag {
  return (
    VALUE_FLAGS as readonly string[]
  ).includes(
    value,
  );
}

// Exactly:
//   --episode <id> --shot <id>
//   --expected-manifest-sha256 <digest> --expected-observation-sha256 <digest>
//   --confirm-adoption
// Each flag at most once; no positional, =value, scene, order, provider,
// credential, stdin, payload, force, overwrite or retry input. Pure: this
// performs no I/O, so every argument error precedes any durable read or write.
export function parseVisualEvidenceAdoptionCliArgs(
  args:
    readonly string[],
): VisualEvidenceAdoptionCliOptions {
  const values =
    new Map<
      ValueFlag,
      string
    >();

  const seen =
    new Set<string>();

  let confirmAdoption =
    false;

  for (
    let index = 0;
    index < args.length;
    index += 1
  ) {
    const argument =
      args[index]!;

    if (
      argument ===
      CONFIRM_FLAG
    ) {
      if (
        seen.has(
          argument,
        )
      ) {
        throw new Error(
          `Duplicate visual evidence adoption CLI argument: ${argument}`,
        );
      }

      seen.add(
        argument,
      );

      confirmAdoption =
        true;

      continue;
    }

    if (
      isValueFlag(
        argument,
      )
    ) {
      if (
        seen.has(
          argument,
        )
      ) {
        throw new Error(
          `Duplicate visual evidence adoption CLI argument: ${argument}`,
        );
      }

      seen.add(
        argument,
      );

      const value =
        args[
          index + 1
        ];

      if (
        value ===
          undefined ||
        value.length ===
          0 ||
        value.startsWith(
          "-",
        )
      ) {
        throw new Error(
          `${argument} requires a value.`,
        );
      }

      values.set(
        argument,
        value,
      );

      index += 1;

      continue;
    }

    if (
      argument.startsWith(
        "-",
      )
    ) {
      // Never echo a value-bearing form: it could carry pasted secrets.
      throw new Error(
        `Unknown visual evidence adoption CLI argument: ${argument.split("=")[0]}`,
      );
    }

    throw new Error(
      "Unexpected positional visual evidence adoption CLI argument.",
    );
  }

  const required =
    (
      flag:
        ValueFlag,
    ): string => {
      const value =
        values.get(
          flag,
        );

      if (
        value ===
        undefined
      ) {
        throw new Error(
          `${flag} is required.`,
        );
      }

      return value;
    };

  const parse =
    <T>(
      flag:
        ValueFlag,

      schema:
        Readonly<{
          safeParse:
            (value: unknown) =>
              | Readonly<{ success: true; data: T }>
              | Readonly<{ success: false }>;
        }>,
    ): T => {
      const result =
        schema.safeParse(
          required(
            flag,
          ),
        );

      if (!result.success) {
        throw new Error(
          `${flag} is invalid.`,
        );
      }

      return result.data;
    };

  const episodeId =
    parse(
      "--episode",
      EpisodeManifestSchema.shape.episodeId,
    );

  const shotId =
    parse(
      "--shot",
      ShotSchema.shape.id,
    );

  const expectedManifestRawSha256 =
    parse(
      "--expected-manifest-sha256",
      VisualEvidenceAdoptionSha256Schema,
    );

  const expectedObservationSha256 =
    parse(
      "--expected-observation-sha256",
      VisualEvidenceAdoptionSha256Schema,
    );

  if (!confirmAdoption) {
    throw new Error(
      `${CONFIRM_FLAG} is required: durable visual evidence adoption is an explicit HUMAN_OPERATOR review.`,
    );
  }

  return Object.freeze({
    episodeId,
    shotId,
    expectedManifestRawSha256,
    expectedObservationSha256,
    confirmAdoption:
      true,
  });
}
