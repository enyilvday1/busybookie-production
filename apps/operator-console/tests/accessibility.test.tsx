import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";

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

const TOKEN = "ab".repeat(32);

function respondWith(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json", "X-Request-Id": "aed7ef66-15f4-48e7-8c37-6d28fa204f09" },
        }),
    ),
  );
}

async function renderUnlocked() {
  const user = userEvent.setup();
  const view = render(<App />);
  await user.type(screen.getByLabelText("Operator token"), TOKEN);
  await user.click(screen.getByRole("button", { name: "Connect" }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return view;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("automated accessibility checks (axe-core in jsdom)", () => {
  it("the LOCKED shell has no violations", async () => {
    const { container } = render(<App />);
    expect(await violations(container)).toEqual([]);
  });

  it("the LOCKED shell with the rejected-token notice has no violations", async () => {
    respondWith(401, { error: { code: "UNAUTHORIZED", message: "m", requestId: "r" } });
    const { container } = await renderUnlocked();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(await violations(container)).toEqual([]);
  });

  it("the connected episode table has no violations", async () => {
    respondWith(200, {
      apiVersion: "v1",
      episodes: [
        { episodeId: "EP02", manifest: "VALID", title: "Ollie finds a shell", sceneCount: 2, shotCount: 7 },
        { episodeId: "EP03", manifest: "INVALID" },
      ],
    });
    const { container } = await renderUnlocked();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(await violations(container)).toEqual([]);
  });

  it("the connected EMPTY state has no violations", async () => {
    respondWith(200, { apiVersion: "v1", episodes: [] });
    const { container } = await renderUnlocked();
    expect(screen.getByText("No episodes were found in this production.")).toBeTruthy();
    expect(await violations(container)).toEqual([]);
  });

  it("the connected error state has no violations", async () => {
    respondWith(503, { error: { code: "STATE_UNAVAILABLE", message: "m", requestId: "r" } });
    const { container } = await renderUnlocked();
    expect(screen.getByText("Production state could not be read.")).toBeTruthy();
    expect(await violations(container)).toEqual([]);
  });

  it("the development reference view has no violations", async () => {
    const { container } = render(<ReferencePage />);
    expect(await violations(container)).toEqual([]);
  });
});
