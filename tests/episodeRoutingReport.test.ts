import { describe, expect, it } from "vitest";

import {
  evaluateEpisodeRouting,
} from "../src/routing/evaluateEpisodeRouting.js";

import { loadCharacterBible } from "../src/validation/loadCharacterBible.js";
import { loadEpisodeManifest } from "../src/validation/loadEpisodeManifest.js";
import { loadProductionRules } from "../src/validation/loadProductionRules.js";
import { loadProviderRoutingPolicy } from "../src/validation/loadProviderRoutingPolicy.js";

async function loadRoutingContext() {
  const [
    bible,
    rules,
    policy,
  ] = await Promise.all([
    loadCharacterBible(),
    loadProductionRules(),
    loadProviderRoutingPolicy(),
  ]);

  return {
    bible,
    rules,
    policy,
  };
}

describe("Busybookie Episode Routing Report", () => {
  it("summarizes the EP02 routing decisions", async () => {
    const [
      episode,
      context,
    ] = await Promise.all([
      loadEpisodeManifest("EP02"),
      loadRoutingContext(),
    ]);

    const report =
      evaluateEpisodeRouting(
        episode,
        context.bible,
        context.rules,
        context.policy,
      );

    expect(report.episodeId).toBe("EP02");
    expect(report.title).toBe("Development Pipeline Test");
    expect(report.totalShots).toBe(2);
    expect(report.summary).toEqual({
      ROUTABLE: 1,
      BLOCKED: 1,
      MANUAL_REVIEW: 0,
      CONFLICT: 0,
    });
  });

  it("reports EP02 shots in global shot order", async () => {
    const [
      episode,
      context,
    ] = await Promise.all([
      loadEpisodeManifest("EP02"),
      loadRoutingContext(),
    ]);

    const report =
      evaluateEpisodeRouting(
        episode,
        context.bible,
        context.rules,
        context.policy,
      );

    expect(
      report.shots.map(
        (shot) => shot.shotId,
      ),
    ).toEqual(["S01", "S02"]);

    expect(report.shots[0]).toMatchObject({
      sceneId: "SC01",
      shotId: "S01",
      order: 1,
      title: "Littleleaf Valley establishing shot",
      decision: {
        disposition: "ROUTABLE",
        recommendedProvider: "RUNWAY",
        currentProvider: "RUNWAY",
      },
    });

    expect(report.shots[1]).toMatchObject({
      sceneId: "SC01",
      shotId: "S02",
      order: 2,
      title: "Ollie discovers something",
      decision: {
        disposition: "BLOCKED",
        recommendedProvider: null,
        currentProvider: "VEO",
      },
    });
  });

  it("aggregates a propagated provider conflict", async () => {
    const [
      episode,
      context,
    ] = await Promise.all([
      loadEpisodeManifest("EP91"),
      loadRoutingContext(),
    ]);

    const conflictEpisode =
      structuredClone(episode);

    const shot =
      conflictEpisode.scenes[0]?.shots[0];

    if (!shot) {
      throw new Error("Expected EP91 S01.");
    }

    shot.generation.provider =
      "RUNWAY";

    const report =
      evaluateEpisodeRouting(
        conflictEpisode,
        context.bible,
        context.rules,
        context.policy,
      );

    expect(report.totalShots).toBe(1);
    expect(report.summary).toEqual({
      ROUTABLE: 0,
      BLOCKED: 0,
      MANUAL_REVIEW: 0,
      CONFLICT: 1,
    });

    expect(report.shots[0]?.decision).toMatchObject({
      disposition: "CONFLICT",
      recommendedProvider: "VEO",
      currentProvider: "RUNWAY",
      manifestConflict: true,
    });
  });

  it("does not mutate routing inputs", async () => {
    const [
      episode,
      context,
    ] = await Promise.all([
      loadEpisodeManifest("EP02"),
      loadRoutingContext(),
    ]);

    const episodeBefore =
      structuredClone(episode);

    const bibleBefore =
      structuredClone(context.bible);

    const rulesBefore =
      structuredClone(context.rules);

    const policyBefore =
      structuredClone(context.policy);

    evaluateEpisodeRouting(
      episode,
      context.bible,
      context.rules,
      context.policy,
    );

    expect(episode).toEqual(
      episodeBefore,
    );

    expect(context.bible).toEqual(
      bibleBefore,
    );

    expect(context.rules).toEqual(
      rulesBefore,
    );

    expect(context.policy).toEqual(
      policyBefore,
    );
  });

  it("aggregates a blocked routing decision", async () => {
    const [
      episode,
      context,
    ] = await Promise.all([
      loadEpisodeManifest("EP91"),
      loadRoutingContext(),
    ]);

    const restrictedRules =
      structuredClone(context.rules);

    restrictedRules.generation.supportedProviders =
      ["RUNWAY", "MANUAL"];

    const report =
      evaluateEpisodeRouting(
        episode,
        context.bible,
        restrictedRules,
        context.policy,
      );

    expect(report.totalShots).toBe(1);
    expect(report.summary).toEqual({
      ROUTABLE: 0,
      BLOCKED: 1,
      MANUAL_REVIEW: 0,
      CONFLICT: 0,
    });

    expect(report.shots[0]?.decision).toMatchObject({
      disposition: "BLOCKED",
      recommendedProvider: "VEO",
      currentProvider: "VEO",
      manifestConflict: false,
    });
  });

  it("sorts report shots by global order when input traversal is reversed", async () => {
    const [
      episode,
      context,
    ] = await Promise.all([
      loadEpisodeManifest("EP02"),
      loadRoutingContext(),
    ]);

    const reversedEpisode =
      structuredClone(episode);

    reversedEpisode.scenes[0]?.shots.reverse();

    const report =
      evaluateEpisodeRouting(
        reversedEpisode,
        context.bible,
        context.rules,
        context.policy,
      );

    expect(
      report.shots.map(
        (shot) => shot.shotId,
      ),
    ).toEqual(["S01", "S02"]);

    expect(
      report.shots.map(
        (shot) => shot.order,
      ),
    ).toEqual([1, 2]);
  });
});
