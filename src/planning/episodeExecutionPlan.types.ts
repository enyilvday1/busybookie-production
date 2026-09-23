import type {
  ExecutionReadinessDisposition,
  ShotExecutionReadiness,
} from "./executionReadiness.types.js";

export type EpisodeExecutionPlanSummary = Readonly<
  Record<ExecutionReadinessDisposition, number>
>;

export type EpisodeExecutionPlanShot = Readonly<{
  sceneId: string;
  sceneTitle: string;
  shotId: string;
  order: number;
  title: string;
  readiness: ShotExecutionReadiness;
}>;

export type EpisodeExecutionPlan = Readonly<{
  episodeId: string;
  title: string;
  totalShots: number;
  summary: EpisodeExecutionPlanSummary;
  shots: readonly EpisodeExecutionPlanShot[];
}>;
