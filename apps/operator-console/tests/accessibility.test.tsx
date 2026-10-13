import { render } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";

import { App } from "../src/App";
import { ReferencePage } from "../src/reference/ReferencePage";

// jsdom does not compute layout or rendered colors, so rules that depend on
// them cannot be evaluated here. Contrast is enforced by tokens.test.ts from
// the token values; layout-dependent checks belong to later real-browser tests.
const LAYOUT_DEPENDENT_RULES = {
  "color-contrast": { enabled: false },
  "target-size": { enabled: false },
} as const;

async function violations(container: HTMLElement) {
  const result = await axe.run(container, { rules: LAYOUT_DEPENDENT_RULES });
  return result.violations.map((violation) => `${violation.id}: ${violation.help}`);
}

describe("automated accessibility checks (axe-core in jsdom)", () => {
  it("the application shell and Overview have no violations", async () => {
    const { container } = render(<App />);
    expect(await violations(container)).toEqual([]);
  });

  it("the development reference view has no violations", async () => {
    const { container } = render(<ReferencePage />);
    expect(await violations(container)).toEqual([]);
  });
});
