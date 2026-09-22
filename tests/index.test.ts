import { describe, expect, it } from "vitest";

import {
  BUSYBOOKIE_PRODUCTION_VERSION,
  getProductionVersion,
} from "../src/index.js";

describe("Busybookie production foundation", () => {
  it("exposes the current production version", () => {
    expect(BUSYBOOKIE_PRODUCTION_VERSION).toBe("0.1.0");
    expect(getProductionVersion()).toBe("0.1.0");
  });
});
