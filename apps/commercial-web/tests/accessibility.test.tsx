import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it } from "vitest";

import { renderAt } from "./renderAt";

// jsdom computes neither layout nor rendered colour, so these two rules cannot
// be evaluated reliably here. Text contrast is enforced from the token values
// by tokens.test.ts; target size is a CSS minimum (--target-min) and belongs
// to later real-browser checks.
const LAYOUT_DEPENDENT_RULES = {
  "color-contrast": { enabled: false },
  "target-size": { enabled: false },
} as const;

// The whole document is checked so page-level rules (one main landmark, one
// H1, content inside landmarks) are evaluated, not just a fragment.
async function violations() {
  const result = await axe.run(document, { rules: LAYOUT_DEPENDENT_RULES });
  return result.violations.map(
    (violation) => `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(" ")).join(", ")})`,
  );
}

describe("automated accessibility checks (axe-core in jsdom)", () => {
  it.each(["/", "/solutions", "/pricing"])("%s has no violations", async (path) => {
    renderAt(path);
    expect(await violations()).toEqual([]);
  });

  it("the page with the mobile navigation open has no violations", async () => {
    const user = userEvent.setup();
    renderAt("/");
    await user.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "true");
    expect(await violations()).toEqual([]);
  });

  it("the not-found state has no violations", async () => {
    renderAt("/not-a-page");
    expect(await violations()).toEqual([]);
  });

  it("decorative icons are hidden from assistive technology", () => {
    renderAt("/");
    for (const svg of document.querySelectorAll("svg")) {
      expect(svg.closest('[aria-hidden="true"]'), svg.outerHTML.slice(0, 80)).not.toBeNull();
    }
  });

  it("contains no autoplaying or any media elements", () => {
    for (const path of ["/", "/solutions", "/pricing"]) {
      const { unmount } = renderAt(path);
      expect(document.querySelectorAll("video, audio, iframe, [autoplay]")).toHaveLength(0);
      unmount();
    }
  });
});
