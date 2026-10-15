import { EditorialDecisionsSchema, type EditorialDecisions } from "./editorialDecisions.schema.js";
import { assertEditorial, freezeEditorial } from "./validateEditorialPlan.js";

export type EditorialDecisionsSourceAuthority = Readonly<{
  episodeId: string;
  manifestSha256: string;
  // Authoritative shots in manifest global order with their admitted normalized asset content hashes.
  shots: readonly Readonly<{ shotId: string; normalizedAssetSha256: string }>[];
}>;

export function parseEditorialDecisions(input: unknown): EditorialDecisions {
  const parsed = EditorialDecisionsSchema.safeParse(input);
  assertEditorial(parsed.success, `decisions schema validation failed: ${parsed.error?.message ?? ""}`);
  const decisions = parsed.data;
  const clipShots = new Set<string>();
  for (const clip of decisions.clips) {
    assertEditorial(!clipShots.has(clip.shotId), `decisions repeat a source-range decision for ${clip.shotId}`);
    clipShots.add(clip.shotId);
  }
  const boundShots = new Set<string>();
  for (const binding of decisions.sourceBinding.shotAssets) {
    assertEditorial(!boundShots.has(binding.shotId), `decisions duplicate the source binding for ${binding.shotId}`);
    boundShots.add(binding.shotId);
  }
  const edges = new Set<string>();
  for (const transition of decisions.transitions) {
    assertEditorial(transition.outgoingShotId !== transition.incomingShotId, "decisions transition joins a shot to itself");
    const key = `${transition.outgoingShotId}>${transition.incomingShotId}`;
    assertEditorial(!edges.has(key), `decisions repeat the transition ${key}`);
    edges.add(key);
  }
  return freezeEditorial(decisions);
}

// Exact union of explicit range shots and both endpoints of every explicit transition (CUT included),
// ordered by authoritative manifest order. A shot reached by several decisions appears once.
export function referencedEditorialDecisionShotIds(
  decisions: EditorialDecisions, shotOrder: readonly string[],
): readonly string[] {
  const referenced = new Set<string>();
  for (const clip of decisions.clips) referenced.add(clip.shotId);
  for (const transition of decisions.transitions) {
    referenced.add(transition.outgoingShotId);
    referenced.add(transition.incomingShotId);
  }
  for (const shotId of referenced) {
    assertEditorial(shotOrder.includes(shotId), `decisions reference unknown shot ${shotId}`);
  }
  return Object.freeze(shotOrder.filter((shotId) => referenced.has(shotId)));
}

export function validateEditorialDecisionsAgainstSource(
  input: unknown, authority: EditorialDecisionsSourceAuthority,
): EditorialDecisions {
  const decisions = parseEditorialDecisions(input);
  const order = authority.shots.map((shot) => shot.shotId);
  assertEditorial(decisions.episodeId === authority.episodeId, "decisions episode identity does not match source authority");
  assertEditorial(decisions.sourceBinding.manifestSha256 === authority.manifestSha256,
    "decisions manifest binding is stale or mismatched");
  const closure = referencedEditorialDecisionShotIds(decisions, order);
  for (const transition of decisions.transitions) {
    const outgoing = order.indexOf(transition.outgoingShotId);
    assertEditorial(order.indexOf(transition.incomingShotId) === outgoing + 1,
      `decisions transition ${transition.outgoingShotId}>${transition.incomingShotId} does not join manifest-adjacent shots`);
  }
  const bound = decisions.sourceBinding.shotAssets.map((binding) => binding.shotId);
  for (const shotId of bound) assertEditorial(order.includes(shotId), `decisions bind unknown shot ${shotId}`);
  const sameSet = bound.length === closure.length && bound.every((shotId) => closure.includes(shotId));
  assertEditorial(sameSet, "decisions source bindings must equal the referenced-shot closure exactly");
  assertEditorial(bound.every((shotId, index) => shotId === closure[index]),
    "decisions source bindings must follow manifest shot order");
  for (const binding of decisions.sourceBinding.shotAssets) {
    const shot = authority.shots.find((candidate) => candidate.shotId === binding.shotId);
    assertEditorial(shot !== undefined && binding.normalizedAssetSha256 === shot.normalizedAssetSha256,
      `decisions normalized asset binding for ${binding.shotId} is stale or mismatched`);
  }
  return decisions;
}
