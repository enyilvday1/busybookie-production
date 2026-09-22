import { z } from "zod";

export const GenerationProviderSchema = z.enum([
  "RUNWAY",
  "VEO",
  "MANUAL",
]);

export const ProductionRulesSchema = z.object({
  schemaVersion: z.literal("1.0"),

  brand: z.object({
    brandName: z.string().trim().min(1),
    showName: z.string().trim().min(1),
    setting: z.string().trim().min(1),
    tagline: z.string().trim().min(1),
  }).strict(),

  postProduction: z.object({
    aspectRatio: z.literal("16:9"),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    timelineFps: z.number().int().positive(),
    audioSampleRateHz: z.number().int().positive(),
  }).strict(),

  storage: z.object({
    mediaRootEnvVar: z.literal("BUSYBOOKIE_MEDIA_ROOT"),
    requireExternalMediaRoot: z.boolean(),
  }).strict(),

  approvals: z.object({
    requireScriptApproval: z.boolean(),
    requireStoryboardApproval: z.boolean(),
    requireReferenceApproval: z.boolean(),
    requireRoughCutApproval: z.boolean(),
    requireFinalQcApproval: z.boolean(),
  }).strict(),

  generation: z.object({
    allowUnapprovedGeneration: z.boolean(),
    maxAutomaticRetries: z.number().int().min(0).max(5),
    supportedProviders: z
      .array(GenerationProviderSchema)
      .min(1),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.postProduction.width !== 1920) {
    ctx.addIssue({
      code: "custom",
      path: ["postProduction", "width"],
      message: "Busybookie production width must be 1920.",
    });
  }

  if (value.postProduction.height !== 1080) {
    ctx.addIssue({
      code: "custom",
      path: ["postProduction", "height"],
      message: "Busybookie production height must be 1080.",
    });
  }

  if (value.postProduction.timelineFps !== 25) {
    ctx.addIssue({
      code: "custom",
      path: ["postProduction", "timelineFps"],
      message: "Busybookie master timeline must remain 25 fps.",
    });
  }

  if (value.postProduction.audioSampleRateHz !== 48000) {
    ctx.addIssue({
      code: "custom",
      path: ["postProduction", "audioSampleRateHz"],
      message: "Busybookie production audio must use 48 kHz.",
    });
  }

  if (value.generation.allowUnapprovedGeneration) {
    ctx.addIssue({
      code: "custom",
      path: ["generation", "allowUnapprovedGeneration"],
      message: "Unapproved automatic generation must remain disabled.",
    });
  }

  const providers = value.generation.supportedProviders;

  if (new Set(providers).size !== providers.length) {
    ctx.addIssue({
      code: "custom",
      path: ["generation", "supportedProviders"],
      message: "Generation providers must be unique.",
    });
  }
});

export type GenerationProvider = z.infer<
  typeof GenerationProviderSchema
>;

export type ProductionRules = z.infer<
  typeof ProductionRulesSchema
>;
