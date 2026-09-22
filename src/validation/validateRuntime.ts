import { loadEnvironment } from "./loadEnvironment.js";
import { loadProductionRules } from "./loadProductionRules.js";
import {
  REQUIRED_MEDIA_DIRECTORIES,
  validateMediaRoot,
} from "./validateMediaRoot.js";

async function main(): Promise<void> {
  const env = loadEnvironment();
  const rules = await loadProductionRules();

  const mediaRoot = await validateMediaRoot(
    env,
    rules,
  );

  console.log(
    "Busybookie runtime environment valid.",
  );

  console.log(
    `Media root: ${mediaRoot}`,
  );

  console.log(
    `Media directories: ${REQUIRED_MEDIA_DIRECTORIES.length}`,
  );

  console.log(
    `Runway credential configured: ${
      Boolean(env.RUNWAYML_API_SECRET)
    }`,
  );

  console.log(
    `Gemini credential configured: ${
      Boolean(env.GEMINI_API_KEY)
    }`,
  );
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : "Unknown runtime validation error";

  console.error(message);
  process.exitCode = 1;
});
