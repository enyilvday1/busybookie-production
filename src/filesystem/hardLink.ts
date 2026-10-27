import { link } from "node:fs/promises";

type HardLinkAttempt =
  | Readonly<{ status: "LINKED" }>
  | Readonly<{ status: "FAILED"; code: string | undefined; error: unknown }>;

export async function attemptHardLink(existingPath: string, newPath: string): Promise<HardLinkAttempt> {
  try {
    await link(existingPath, newPath);
    return { status: "LINKED" };
  } catch (error) {
    let code: string | undefined;
    if (typeof error === "object" && error !== null) {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(error, "code");
        if (descriptor && "value" in descriptor && typeof descriptor.value === "string") code = descriptor.value;
      } catch {
        // An opaque thrown value must still be returned unchanged.
      }
    }
    return { status: "FAILED", code, error };
  }
}
