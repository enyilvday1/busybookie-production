import { z } from "zod";

export const ProviderRoutingPolicySchema = z.object({
  schemaVersion: z.literal("1.0"),

  nonDialogue: z.object({
    nativeAudioProvider: z.literal("VEO"),
    visualOnlyProvider: z.literal("RUNWAY"),
  }).strict(),

  dialogue: z.object({
    requireLockedVoices: z.literal(true),
    automaticProviderSelection: z.literal(false),
    treatDialogueShotTypeAsDialogueIntent: z.literal(true),
  }).strict(),

  manifest: z.object({
    flagProviderMismatch: z.literal(true),
  }).strict(),
}).strict();

export type ProviderRoutingPolicy = z.infer<
  typeof ProviderRoutingPolicySchema
>;
