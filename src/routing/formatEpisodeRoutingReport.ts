import type {
  EpisodeRoutingReport,
  EpisodeRoutingShot,
} from "./episodeRoutingReport.types.js";

function formatShotLine(
  shot: EpisodeRoutingShot,
): string {
  const disposition =
    shot.decision.disposition
      .padEnd(13, " ");

  const recommendedProvider =
    shot.decision.recommendedProvider ??
    "unresolved";

  return (
    `${shot.shotId}  ${disposition}  ` +
    `current=${shot.decision.currentProvider}  ` +
    `recommended=${recommendedProvider}`
  );
}

export function formatEpisodeRoutingReport(
  report: EpisodeRoutingReport,
): string {
  const lines = [
    "===== Busybookie Episode Routing Report =====",
    "",
    `Episode: ${report.episodeId} - ${report.title}`,
    `Shots: ${report.totalShots}`,
    "",
    "Summary",
    `ROUTABLE: ${report.summary.ROUTABLE}`,
    `BLOCKED: ${report.summary.BLOCKED}`,
    `MANUAL_REVIEW: ${report.summary.MANUAL_REVIEW}`,
    `CONFLICT: ${report.summary.CONFLICT}`,
    "",
    "Shots",
    ...report.shots.map(
      (shot) => formatShotLine(shot),
    ),
  ];

  return lines.join("\n");
}
