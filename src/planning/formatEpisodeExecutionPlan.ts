import type {
  EpisodeExecutionPlan,
  EpisodeExecutionPlanShot,
} from "./episodeExecutionPlan.types.js";

function formatShotLines(
  shot: EpisodeExecutionPlanShot,
): readonly string[] {
  const disposition =
    shot.readiness.disposition
      .padEnd(13, " ");

  const executionProvider =
    shot.readiness.executionProvider ??
    "unresolved";

  const lines = [
    `${shot.shotId}  ${disposition}  provider=${executionProvider}`,
  ];

  for (
    const blocker of
      shot.readiness.blockers
  ) {
    lines.push(
      `  blocker: ${blocker}`,
    );
  }

  return lines;
}

export function formatEpisodeExecutionPlan(
  plan: EpisodeExecutionPlan,
): string {
  const lines = [
    "===== Busybookie Episode Execution Plan =====",
    "",
    `Episode: ${plan.episodeId} - ${plan.title}`,
    `Shots: ${plan.totalShots}`,
    "",
    "Summary",
    `EXECUTABLE: ${plan.summary.EXECUTABLE}`,
    `NOT_READY: ${plan.summary.NOT_READY}`,
    `MANUAL_REVIEW: ${plan.summary.MANUAL_REVIEW}`,
    `CONFLICT: ${plan.summary.CONFLICT}`,
    `BLOCKED: ${plan.summary.BLOCKED}`,
    "",
    "Shots",
  ];

  for (const shot of plan.shots) {
    lines.push(
      ...formatShotLines(shot),
    );
  }

  return lines.join("\n");
}
