import {
  readFile,
} from "node:fs/promises";

import {
  resolve,
} from "node:path";

import {
  VeoPolicySchema,
  type VeoPolicy,
} from "../schemas/veoPolicy.schema.js";

export async function loadVeoPolicy():
Promise<VeoPolicy> {
  const policyPath =
    resolve(
      process.cwd(),
      "config",
      "veo-policy.json",
    );

  const raw =
    await readFile(
      policyPath,
      "utf8",
    );

  let parsed:
    unknown;

  try {
    parsed =
      JSON.parse(
        raw,
      );
  } catch (error) {
    throw new Error(
      `Veo policy JSON is invalid: ${policyPath}`,
      {
        cause: error,
      },
    );
  }

  const result =
    VeoPolicySchema
      .safeParse(
        parsed,
      );

  if (!result.success) {
    throw new Error(
      `Veo policy validation failed:\n${result.error.message}`,
    );
  }

  return result.data;
}
