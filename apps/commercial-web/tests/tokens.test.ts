import { describe, expect, it } from "vitest";

import tokensCss from "../src/styles/tokens.css?raw";

// Contrast is checked from the provisional token values because jsdom cannot
// compute rendered colours (see accessibility.test.tsx).

function colourTokens(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const match of css.matchAll(/--(color-[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    tokens.set(match[1]!, match[2]!.toLowerCase());
  }
  return tokens;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const tokens = colourTokens(tokensCss);

function token(name: string): string {
  const value = tokens.get(name);
  expect(value, `token --${name}`).toBeDefined();
  return value!;
}

const REQUIRED_ROLES = [
  "color-brand-primary",
  "color-brand-secondary",
  "color-surface",
  "color-surface-elevated",
  "color-surface-muted",
  "color-surface-inverse",
  "color-text-primary",
  "color-text-secondary",
  "color-text-muted",
  "color-border-subtle",
  "color-focus",
  "color-success",
  "color-warning",
  "color-danger",
];

// [foreground, background] pairs used for text: WCAG AA 4.5:1.
const TEXT_PAIRS: readonly [string, string][] = [
  ...["color-surface", "color-surface-elevated", "color-surface-muted"].flatMap((surface) =>
    ["color-text-primary", "color-text-secondary", "color-text-muted", "color-brand-secondary", "color-brand-primary-strong"].map(
      (text) => [text, surface] as [string, string],
    ),
  ),
  ["color-on-brand-primary", "color-brand-primary"],
  ["color-on-brand-primary", "color-brand-primary-strong"],
  ["color-brand-primary-strong", "color-brand-primary-soft"],
  ["color-text-primary", "color-brand-primary-soft"],
  ["color-text-secondary", "color-brand-primary-soft"],
  ["color-text-on-inverse", "color-surface-inverse"],
  ["color-text-on-inverse-muted", "color-surface-inverse"],
  ["color-success", "color-success-soft"],
  ["color-warning", "color-warning-soft"],
  ["color-warning", "color-surface-elevated"],
  ["color-danger", "color-danger-soft"],
  ["color-text-muted", "color-surface-muted"],
  // Closing banner: white and muted text against the lightest gradient stop.
  ["color-text-on-inverse", "color-banner-end"],
  ["color-text-on-inverse-muted", "color-banner-end"],
  ["color-text-on-inverse", "color-banner-start"],
  ["color-text-primary", "color-brand-secondary-soft"],
  ["color-text-secondary", "color-brand-secondary-soft"],
];

// Focus indicators and meaningful non-text marks: WCAG 1.4.11, 3:1.
const NON_TEXT_PAIRS: readonly [string, string][] = [
  ["color-focus", "color-surface"],
  ["color-focus", "color-surface-elevated"],
  ["color-focus", "color-surface-muted"],
  ["color-focus-on-inverse", "color-surface-inverse"],
  ["color-success", "color-surface-elevated"],
  ["color-focus-on-inverse", "color-banner-end"],
  ["color-brand-primary", "color-surface-elevated"],
  // Decorative accent icons and strokes on their own tints and on white.
  ...["violet", "indigo", "teal", "peach", "rose", "amber"].flatMap((accent) => [
    [`color-accent-${accent}`, `color-accent-${accent}-soft`] as [string, string],
    [`color-accent-${accent}`, "color-surface-elevated"] as [string, string],
  ]),
];

describe("design tokens", () => {
  it("define every required semantic colour role", () => {
    for (const role of REQUIRED_ROLES) {
      token(role);
    }
  });

  it("are documented as provisional, not final brand colours", () => {
    expect(tokensCss).toMatch(/PROVISIONAL PRESENTATION VALUES/);
  });

  it.each(TEXT_PAIRS)("%s on %s meets 4.5:1", (foreground, background) => {
    expect(contrast(token(foreground), token(background))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT_PAIRS)("%s against %s meets 3:1", (foreground, background) => {
    expect(contrast(token(foreground), token(background))).toBeGreaterThanOrEqual(3);
  });
});
