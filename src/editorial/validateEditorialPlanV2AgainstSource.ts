import { buildEditorialPlan } from "./buildEditorialPlan.js";
import { canonicalEditorialJson } from "./canonicalizeEditorialPlan.js";
import { hashEditorialDecisions } from "./canonicalizeEditorialPlanV2.js";
import type { EditorialPlanV2 } from "./editorialPlanV2.schema.js";
import { migrateEditorialPlanV1ToV2 } from "./migrateEditorialPlan.js";
import {
  validateEditorialDecisionsAgainstSource, type EditorialDecisionsSourceAuthority,
} from "./validateEditorialDecisions.js";
import { assertEditorial } from "./validateEditorialPlan.js";
import type { EditorialPlanSourceInput } from "./validateEditorialPlanAgainstSource.js";
import { validateEditorialPlanV2 } from "./validateEditorialPlanV2.js";

export type ValidateEditorialPlanV2AgainstSourceInput = Readonly<{
  plan: unknown;
  source: EditorialPlanSourceInput;
  // null or undefined means no decisions document (defaults: full ranges, all CUT).
  decisions: unknown;
}>;

export function editorialDecisionsSourceAuthority(reference: EditorialPlanV2): EditorialDecisionsSourceAuthority {
  return {
    episodeId: reference.episode.episodeId,
    manifestSha256: reference.episode.manifestSha256,
    shots: reference.shots.map((shot, index) => ({ shotId: shot.shotId, normalizedAssetSha256: reference.assets[index]!.sha256 })),
  };
}

function same(left: unknown, right: unknown): boolean {
  return canonicalEditorialJson(left) === canonicalEditorialJson(right);
}

// Independent of the 2.0 builder: the reference is the proven 1.0 source-validated projection, migrated.
export function validateEditorialPlanV2AgainstSource(input: ValidateEditorialPlanV2AgainstSourceInput): void {
  const plan = validateEditorialPlanV2(input.plan);
  const reference = migrateEditorialPlanV1ToV2(buildEditorialPlan(input.source));
  assertEditorial(same(plan.episode, reference.episode), "2.0 episode identity or manifest hash diverges from source authority");
  assertEditorial(same(plan.profile, reference.profile), "2.0 profile diverges from source authority");
  assertEditorial(same(plan.shots, reference.shots), "2.0 shot identity/order/ownership diverges from source authority");
  assertEditorial(same(plan.assets, reference.assets), "2.0 asset identity/content/duration/provenance diverges from source authority");
  for (const [index, clip] of plan.tracks[1].clips.entries()) {
    assertEditorial(same(clip.audio, reference.tracks[1].clips[index]!.audio),
      `2.0 audio evidence for ${clip.shotId} diverges from source authority`);
  }
  if (input.decisions === null || input.decisions === undefined) {
    assertEditorial(plan.editorialDecisionsSha256 === null, "2.0 plan records decisions provenance but no decisions were supplied");
    assertEditorial(same(plan, reference), "2.0 plan without decisions must equal the full-range all-CUT source resolution");
    return;
  }
  const decisions = validateEditorialDecisionsAgainstSource(input.decisions, editorialDecisionsSourceAuthority(reference));
  assertEditorial(plan.editorialDecisionsSha256 === hashEditorialDecisions(decisions),
    "2.0 plan decisions provenance does not match the supplied decisions document");
  for (const [index, shot] of plan.shots.entries()) {
    const clip = plan.tracks[0].clips[index]!;
    const requested = decisions.clips.find((candidate) => candidate.shotId === shot.shotId);
    const expectedIn = requested ? requested.sourceInFrame : 0;
    const expectedOut = requested ? requested.sourceOutFrame : plan.assets[index]!.assetDurationFrames;
    assertEditorial(clip.sourceInFrame === expectedIn && clip.sourceOutFrame === expectedOut,
      `2.0 source range for ${shot.shotId} diverges from the decisions document`);
  }
  for (const [index, transition] of plan.transitions.entries()) {
    const outgoing = plan.shots[index]!.shotId;
    const incoming = plan.shots[index + 1]!.shotId;
    const requested = decisions.transitions.find((candidate) => candidate.outgoingShotId === outgoing && candidate.incomingShotId === incoming);
    const expectedOverlap = requested && requested.type === "CROSS_DISSOLVE" ? requested.overlapFrames : 0;
    const actualOverlap = transition.type === "CROSS_DISSOLVE" ? transition.overlapFrames : 0;
    assertEditorial(transition.type === (requested ? requested.type : "CUT") && actualOverlap === expectedOverlap,
      `2.0 transition ${outgoing}>${incoming} diverges from the decisions document`);
  }
}
