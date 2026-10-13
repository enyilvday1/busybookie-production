import type {
  EpisodeRoughCutRenderStatus,
} from "../ensureEpisodeRoughCutRender.js";

import {
  runProductionEpisodeRoughCut,
  type RunProductionEpisodeRoughCutResult,
} from "../runProductionEpisodeRoughCut.js";

import {
  parseEpisodeRoughCutCliArgs,
} from "./episodeRoughCutCliArgs.js";

export type RunEpisodeRoughCutCliDependencies =
  Readonly<{
    runComposition:
      typeof runProductionEpisodeRoughCut;

    writeStdout:
      (text: string) => void;
  }>;

const defaultDependencies:
  RunEpisodeRoughCutCliDependencies =
    Object.freeze({
      runComposition:
        runProductionEpisodeRoughCut,

      writeStdout:
        (text: string) => {
          process.stdout.write(
            text,
          );
        },
    });

// Raised only when the rough-cut operation already returned and the success
// report could not be written. roughCutResult is the exact returned result
// (MATERIALIZED or HIT); it describes the rough cut only. Composition is
// never repeated to recover the report.
export class EpisodeRoughCutCliOutputError extends Error {
  readonly roughCutResult:
    RunProductionEpisodeRoughCutResult;

  constructor(
    roughCutResult:
      RunProductionEpisodeRoughCutResult,

    cause:
      unknown,
  ) {
    super(
      "Episode rough-cut operation returned, but CLI reporting failed. Inspect the reported rough-cut artifact and render record before invoking again.",
      {
        cause,
      },
    );

    this.name =
      "EpisodeRoughCutCliOutputError";

    this.roughCutResult =
      roughCutResult;
  }
}

const SUCCESS_SUMMARY:
  Readonly<Record<
    EpisodeRoughCutRenderStatus,
    string
  >> =
    Object.freeze({
      MATERIALIZED:
        "Episode rough cut rendered and recorded.",

      HIT:
        "Existing episode rough cut verified and reused.",
    });

function formatSuccessOutput(
  result:
    RunProductionEpisodeRoughCutResult,
): string {
  const {
    roughCut,
  } = result;

  return `${JSON.stringify(
    {
      episodeId:
        result.episodeId,

      artifactKind:
        "ROUGH_CUT",

      summary:
        SUCCESS_SUMMARY[
          roughCut.renderStatus
        ],

      renderStatus:
        roughCut.renderStatus,

      renderKey:
        roughCut.renderPlan
          .renderKey,

      outputPath:
        roughCut.artifact
          .outputPath,

      renderRecordPath:
        result.renderRecordPath,

      bytes:
        roughCut.artifact
          .bytes,

      sha256:
        roughCut.artifact
          .sha256,

      durationSeconds:
        roughCut.artifact
          .durationSeconds,
    },
    null,
    2,
  )}\n`;
}

export async function runEpisodeRoughCutCli(
  args:
    readonly string[] =
      process.argv.slice(
        2,
      ),

  dependencies:
    RunEpisodeRoughCutCliDependencies =
      defaultDependencies,
): Promise<void> {
  // 1. All argv before any other work.
  const options =
    parseEpisodeRoughCutCliArgs(
      args,
    );

  // 2. Exactly one rough-cut operation; its failures propagate unchanged.
  const result =
    await dependencies
      .runComposition({
        episodeId:
          options.episodeId,

        confirmLocalComposition:
          options.confirmLocalComposition,
      });

  // 3. Report only after the operation has fully returned.
  try {
    dependencies
      .writeStdout(
        formatSuccessOutput(
          result,
        ),
      );
  } catch (
    error
  ) {
    throw new EpisodeRoughCutCliOutputError(
      result,
      error,
    );
  }
}

/*
 * Failure formatting (Step 968 section 8). Only Error.message and
 * Error.cause are read; stacks, names and other fields are never read, and
 * non-Error values are described by type only. Every message is split into
 * normalized lines, at most 6 are kept (first + last 5 with an omission
 * marker), and each kept line is bounded to 300 code points. Causes are
 * followed iteratively to depth 4 with identity cycle detection. Selection
 * is positional; message text is never classified.
 */

const ERROR_FORMATTER_CAUSE_DEPTH =
  4;

const MESSAGE_LINE_MAX_CODE_POINTS =
  300;

const MESSAGE_MAX_LINES =
  6;

const MESSAGE_TAIL_LINES =
  5;

const FORMATTER_FALLBACK =
  "Episode rough-cut operation failed. The failure could not be described safely; nothing was rolled back.\n";

const GENERIC_FAILURE_FOOTER =
  Object.freeze([
    "Derived local artifacts (normalization caches, rough-cut media, render records) may exist from this attempt; nothing was rolled back.",
    "No retry, recovery or reconciliation was attempted. Inspect the reported condition before invoking again.",
  ]);

const REPORTING_FAILURE_FOOTER =
  "Do not repeat the operation to recover this report. A later explicit invocation verifies and reuses the recorded rough cut.";

const CONTROL_CHARACTERS =
  /[\u0000-\u001f\u007f]/g;

function describeType(
  value:
    unknown,
): string {
  return value ===
    null
    ? "null"
    : typeof value;
}

function truncateLine(
  line:
    string,
): string {
  const codePoints =
    Array.from(
      line,
    );

  return codePoints.length >
    MESSAGE_LINE_MAX_CODE_POINTS
    ? `${codePoints.slice(0, MESSAGE_LINE_MAX_CODE_POINTS).join("")}...`
    : line;
}

function normalizeMessageLines(
  message:
    unknown,
): readonly string[] {
  if (
    typeof message !==
    "string"
  ) {
    return [
      "(non-string message)",
    ];
  }

  const lines =
    message
      .split(
        /\r\n|\r|\n/,
      )
      .map(
        (line) =>
          line
            .replace(
              CONTROL_CHARACTERS,
              " ",
            )
            .trim(),
      )
      .filter(
        (line) =>
          line.length >
          0,
      );

  if (
    lines.length ===
    0
  ) {
    return [
      "(empty message)",
    ];
  }

  if (
    lines.length <=
    MESSAGE_MAX_LINES
  ) {
    return lines.map(
      truncateLine,
    );
  }

  return [
    truncateLine(
      lines[0] ?? "",
    ),
    `... ${lines.length - 1 - MESSAGE_TAIL_LINES} lines omitted ...`,
    ...lines
      .slice(
        -MESSAGE_TAIL_LINES,
      )
      .map(
        truncateLine,
      ),
  ];
}

function isErrorValue(
  value:
    unknown,
): boolean | null {
  try {
    return value instanceof
      Error;
  } catch {
    return null;
  }
}

function readMessageLines(
  error:
    Error,
): readonly string[] {
  let message:
    unknown;

  try {
    message =
      error.message;
  } catch {
    return [
      "(message unavailable)",
    ];
  }

  return normalizeMessageLines(
    message,
  );
}

function labelledBlock(
  label:
    string,

  lines:
    readonly string[],
): string[] {
  const [
    first,
    ...rest
  ] = lines;

  return [
    `${label}${first ?? ""}`,
    ...rest.map(
      (line) =>
        `  ${line}`,
    ),
  ];
}

function reasonBlock(
  value:
    unknown,
): string[] {
  return isErrorValue(
    value,
  ) ===
    true
    ? labelledBlock(
        "Reason: ",
        readMessageLines(
          value as Error,
        ),
      )
    : [
        `Reason: non-Error value thrown (type ${describeType(value)}); contents not shown.`,
      ];
}

function causeBlocks(
  start:
    unknown,

  visited:
    Set<unknown>,
): string[] {
  if (
    isErrorValue(
      start,
    ) !==
    true
  ) {
    return [];
  }

  const lines:
    string[] =
      [];

  let current =
    start as Error;

  visited.add(
    current,
  );

  for (
    let depth = 1;
    ;
    depth += 1
  ) {
    let cause:
      unknown;

    try {
      cause =
        current.cause;
    } catch {
      lines.push(
        `Cause ${depth}: cause unavailable; traversal stopped.`,
      );

      break;
    }

    if (
      cause ===
      undefined
    ) {
      break;
    }

    if (
      depth >
      ERROR_FORMATTER_CAUSE_DEPTH
    ) {
      lines.push(
        `Causes beyond depth ${ERROR_FORMATTER_CAUSE_DEPTH} omitted.`,
      );

      break;
    }

    const causeIsError =
      isErrorValue(
        cause,
      );

    if (
      causeIsError ===
      null
    ) {
      lines.push(
        `Cause ${depth}: cause unavailable; traversal stopped.`,
      );

      break;
    }

    if (
      !causeIsError
    ) {
      lines.push(
        `Cause ${depth}: non-Error value (type ${describeType(cause)}); contents not shown.`,
      );

      break;
    }

    if (
      visited.has(
        cause,
      )
    ) {
      lines.push(
        `Cause ${depth}: cause cycle detected; traversal stopped.`,
      );

      break;
    }

    visited.add(
      cause,
    );

    lines.push(
      ...labelledBlock(
        `Cause ${depth}: `,
        readMessageLines(
          cause as Error,
        ),
      ),
    );

    current =
      cause as Error;
  }

  return lines;
}

function formatReportingFailure(
  error:
    EpisodeRoughCutCliOutputError,
): string[] {
  const result =
    error.roughCutResult;

  let cause:
    unknown;

  try {
    cause =
      error.cause;
  } catch {
    cause =
      undefined;
  }

  return [
    "Episode rough-cut operation returned, but CLI reporting failed.",
    ...labelledBlock(
      "Episode: ",
      normalizeMessageLines(
        result.episodeId,
      ),
    ),
    ...labelledBlock(
      "Render status: ",
      normalizeMessageLines(
        result.roughCut.renderStatus,
      ),
    ),
    ...labelledBlock(
      "Rough-cut output: ",
      normalizeMessageLines(
        result.roughCut.artifact
          .outputPath,
      ),
    ),
    ...labelledBlock(
      "Render record: ",
      normalizeMessageLines(
        result.renderRecordPath,
      ),
    ),
    ...labelledBlock(
      "Rough-cut SHA-256: ",
      normalizeMessageLines(
        result.roughCut.artifact
          .sha256,
      ),
    ),
    ...reasonBlock(
      cause,
    ),
    ...causeBlocks(
      cause,
      new Set<unknown>([
        error,
      ]),
    ),
    REPORTING_FAILURE_FOOTER,
  ];
}

// Single formatting authority for every C8 operator failure. Never throws.
export function formatEpisodeRoughCutCliError(
  error:
    unknown,
): string {
  try {
    let isReportingFailure =
      false;

    try {
      isReportingFailure =
        error instanceof
        EpisodeRoughCutCliOutputError;
    } catch {
      isReportingFailure =
        false;
    }

    const lines =
      isReportingFailure
        ? formatReportingFailure(
            error as EpisodeRoughCutCliOutputError,
          )
        : [
            "Episode rough-cut operation failed.",
            ...reasonBlock(
              error,
            ),
            ...causeBlocks(
              error,
              new Set<unknown>(),
            ),
            ...GENERIC_FAILURE_FOOTER,
          ];

    return `${lines.join("\n")}\n`;
  } catch {
    return FORMATTER_FALLBACK;
  }
}
