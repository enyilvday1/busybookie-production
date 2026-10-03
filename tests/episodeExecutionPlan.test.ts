import {
  describe,
  expect,
  it,
} from "vitest";

import {
  evaluateEpisodeExecutionPlan,
} from "../src/planning/evaluateEpisodeExecutionPlan.js";

import {
  loadCharacterBible,
} from "../src/validation/loadCharacterBible.js";

import {
  loadEpisodeManifest,
} from "../src/validation/loadEpisodeManifest.js";

import {
  loadProductionRules,
} from "../src/validation/loadProductionRules.js";

import {
  loadProviderRoutingPolicy,
} from "../src/validation/loadProviderRoutingPolicy.js";

async function loadPlanningContext() {
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

describe(
  "Busybookie Episode Execution Plan",
  () => {
    it(
      "plans EP90 as one executable Runway shot",
      async () => {
        const [
          episode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest("EP90"),
          loadPlanningContext(),
        ]);

        const plan =
          evaluateEpisodeExecutionPlan(
            episode,
            context.bible,
            context.rules,
            context.policy,
          );

        expect(plan.episodeId).toBe("EP90");
        expect(plan.totalShots).toBe(1);
        expect(plan.summary).toEqual({
          EXECUTABLE: 1,
          NOT_READY: 0,
          MANUAL_REVIEW: 0,
          CONFLICT: 0,
          BLOCKED: 0,
        });

        expect(plan.shots[0]).toMatchObject({
          shotId: "S01",
          order: 1,
          readiness: {
            disposition: "EXECUTABLE",
            executionProvider: "RUNWAY",
          },
        });
      },
    );

    it(
      "plans EP91 as one executable Veo shot",
      async () => {
        const [
          episode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest("EP91"),
          loadPlanningContext(),
        ]);

        const plan =
          evaluateEpisodeExecutionPlan(
            episode,
            context.bible,
            context.rules,
            context.policy,
          );

        expect(plan.summary.EXECUTABLE).toBe(1);
        expect(plan.shots[0]?.readiness).toMatchObject({
          disposition: "EXECUTABLE",
          executionProvider: "VEO",
        });
      },
    );

    it(
      "preserves mixed readiness states for EP02",
      async () => {
        const [
          episode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest("EP02"),
          loadPlanningContext(),
        ]);

        const plan =
          evaluateEpisodeExecutionPlan(
            episode,
            context.bible,
            context.rules,
            context.policy,
          );

        expect(plan.summary).toEqual({
          EXECUTABLE: 0,
          NOT_READY: 1,
          MANUAL_REVIEW: 0,
          CONFLICT: 0,
          BLOCKED: 1,
        });

        expect(plan.shots[0]?.readiness).toMatchObject({
          disposition: "NOT_READY",
          executionProvider: "RUNWAY",
        });

        expect(
          plan.shots[0]?.readiness.blockers.join(" "),
        ).toMatch(/status is DRAFT/i);

        expect(plan.shots[1]?.readiness).toMatchObject({
          disposition: "BLOCKED",
          executionProvider: null,
        });

        expect(
          plan.shots[1]?.readiness.blockers.join(" "),
        ).toMatch(
          /Ollie requires dialogue but no approved voice is locked/i,
        );
      },
    );

    it(
      "returns shots in global shot order regardless of traversal order",
      async () => {
        const [
          sourceEpisode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest("EP02"),
          loadPlanningContext(),
        ]);

        const episode =
          structuredClone(sourceEpisode);

        const scene =
          episode.scenes[0];

        if (!scene) {
          throw new Error(
            "Expected EP02 scene SC01.",
          );
        }

        scene.shots.reverse();

        const plan =
          evaluateEpisodeExecutionPlan(
            episode,
            context.bible,
            context.rules,
            context.policy,
          );

        expect(
          plan.shots.map(
            (shot) => shot.shotId,
          ),
        ).toEqual([
          "S01",
          "S02",
        ]);
      },
    );

    it(
      "keeps conflict blocked and not-ready states distinct",
      async () => {
        const [
          sourceEpisode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest("EP91"),
          loadPlanningContext(),
        ]);

        const conflictEpisode =
          structuredClone(sourceEpisode);
        const conflictShot =
          conflictEpisode.scenes[0]?.shots[0];

        if (!conflictShot) {
          throw new Error("Expected EP91 S01.");
        }

        conflictShot.generation.provider =
          "RUNWAY";

        const conflictPlan =
          evaluateEpisodeExecutionPlan(
            conflictEpisode,
            context.bible,
            context.rules,
            context.policy,
          );

        expect(conflictPlan.summary.CONFLICT).toBe(1);
        expect(
          conflictPlan.shots[0]?.readiness.disposition,
        ).toBe("CONFLICT");

        const blockedRules =
          structuredClone(context.rules);

        blockedRules.generation.supportedProviders =
          blockedRules.generation.supportedProviders.filter(
            (provider) => provider !== "VEO",
          );

        const blockedPlan =
          evaluateEpisodeExecutionPlan(
            sourceEpisode,
            context.bible,
            blockedRules,
            context.policy,
          );

        expect(blockedPlan.summary.BLOCKED).toBe(1);
        expect(
          blockedPlan.shots[0]?.readiness.disposition,
        ).toBe("BLOCKED");

        const notReadyEpisode =
          structuredClone(sourceEpisode);
        const notReadyShot =
          notReadyEpisode.scenes[0]?.shots[0];

        if (!notReadyShot) {
          throw new Error("Expected EP91 S01.");
        }

        notReadyShot.references.required =
          false;

        const notReadyPlan =
          evaluateEpisodeExecutionPlan(
            notReadyEpisode,
            context.bible,
            context.rules,
            context.policy,
          );

        expect(notReadyPlan.summary.NOT_READY).toBe(1);
        expect(
          notReadyPlan.shots[0]?.readiness.disposition,
        ).toBe("NOT_READY");
      },
    );

    it(
      "summary counts exactly match the shot decisions",
      async () => {
        const [
          episode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest("EP02"),
          loadPlanningContext(),
        ]);

        const plan =
          evaluateEpisodeExecutionPlan(
            episode,
            context.bible,
            context.rules,
            context.policy,
          );

        const counted = {
          EXECUTABLE: 0,
          NOT_READY: 0,
          MANUAL_REVIEW: 0,
          CONFLICT: 0,
          BLOCKED: 0,
        };

        for (const shot of plan.shots) {
          counted[
            shot.readiness.disposition
          ] += 1;
        }

        expect(plan.summary).toEqual(counted);

        expect(
          Object.values(plan.summary).reduce(
            (total, count) => total + count,
            0,
          ),
        ).toBe(plan.totalShots);
      },
    );

    it(
      "does not mutate planning inputs",
      async () => {
        const [
          episode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest("EP02"),
          loadPlanningContext(),
        ]);

        const episodeBefore =
          structuredClone(episode);
        const bibleBefore =
          structuredClone(context.bible);
        const rulesBefore =
          structuredClone(context.rules);
        const policyBefore =
          structuredClone(context.policy);

        evaluateEpisodeExecutionPlan(
          episode,
          context.bible,
          context.rules,
          context.policy,
        );

        expect(episode).toEqual(episodeBefore);
        expect(context.bible).toEqual(bibleBefore);
        expect(context.rules).toEqual(rulesBefore);
        expect(context.policy).toEqual(policyBefore);
      },
    );
  },
);
