import type {
  ProviderRoutingDecision,
  ProviderRoutingDisposition,
} from "./providerRouter.types.js";

export type EpisodeRoutingSummary = Readonly<
  Record<ProviderRoutingDisposition, number>
>;

export type EpisodeRoutingShot = Readonly<{
  sceneId: string;
  sceneTitle: string;
  shotId: string;
  order: number;
  title: string;
  decision: ProviderRoutingDecision;
}>;

export type EpisodeRoutingReport = Readonly<{
  episodeId: string;
  title: string;
  totalShots: number;
  summary: EpisodeRoutingSummary;
  shots: readonly EpisodeRoutingShot[];
}>;
