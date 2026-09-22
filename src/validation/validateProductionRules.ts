import { loadProductionRules } from "./loadProductionRules.js";

async function main(): Promise<void> {
  const rules = await loadProductionRules();

  console.log("Busybookie Production Rules valid.");
  console.log(`Brand: ${rules.brand.brandName}`);
  console.log(`Show: ${rules.brand.showName}`);
  console.log(`Setting: ${rules.brand.setting}`);
  console.log(`Tagline: ${rules.brand.tagline}`);

  console.log(
    `Master format: ${rules.postProduction.width}x${rules.postProduction.height} @ ${rules.postProduction.timelineFps} fps`,
  );

  console.log(
    `Audio: ${rules.postProduction.audioSampleRateHz} Hz`,
  );

  console.log(
    `Media root environment variable: ${rules.storage.mediaRootEnvVar}`,
  );

  console.log(
    `Providers: ${rules.generation.supportedProviders.join(", ")}`,
  );

  console.log(
    `Unapproved generation allowed: ${rules.generation.allowUnapprovedGeneration}`,
  );
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : "Unknown validation error";

  console.error(message);
  process.exitCode = 1;
});
