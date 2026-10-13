import { describe, expect, it } from "vitest";

import baseCss from "../src/styles/base.css?raw";
import tokensCss from "../src/styles/tokens.css?raw";

type TokenSet = Readonly<Record<string, string>>;

function declarations(block: string): TokenSet {
  const result: Record<string, string> = {};

  for (const match of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    result[match[1] as string] = (match[2] as string).trim();
  }

  return result;
}

const lightBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(tokensCss)?.[1] ?? "";
const darkBlock = /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([\s\S]*?)\n {2}\}/.exec(tokensCss)?.[1] ?? "";
const light = declarations(lightBlock);
const dark = { ...light, ...declarations(darkBlock) };
const themes: ReadonlyArray<readonly [string, TokenSet]> = [
  ["light", light],
  ["dark", dark],
];

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function color(set: TokenSet, name: string): string {
  const value = set[name];

  if (value === undefined || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`Token ${name} is missing or not a 6-digit hex color.`);
  }

  return value;
}

const SURFACES = ["--color-canvas", "--color-surface", "--color-surface-raised"];
const TEXT_TOKENS = [
  "--color-text",
  "--color-text-secondary",
  "--color-text-muted",
  "--color-accent",
  "--color-success",
  "--color-warning",
  "--color-danger",
  "--color-info",
];
const NON_TEXT_UI_TOKENS = ["--color-border-strong", "--color-focus", "--color-disabled"];
const STATUS_TOKENS = ["--color-success", "--color-warning", "--color-danger", "--color-info"];

describe("design tokens", () => {
  it("defines every color token in both themes", () => {
    const lightColors = Object.keys(light).filter((name) => name.startsWith("--color-"));
    expect(lightColors.length).toBeGreaterThan(20);
    for (const name of lightColors) {
      expect(declarations(darkBlock)[name], `dark ${name}`).toBeDefined();
    }
  });

  it.each(themes)("%s: text tokens meet 4.5:1 on every surface", (_theme, set) => {
    for (const foreground of TEXT_TOKENS) {
      for (const background of SURFACES) {
        expect(contrast(color(set, foreground), color(set, background)), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each(themes)("%s: border-strong, focus and disabled meet 3:1 on every surface", (_theme, set) => {
    for (const foreground of NON_TEXT_UI_TOKENS) {
      for (const background of SURFACES) {
        expect(contrast(color(set, foreground), color(set, background)), `${foreground} on ${background}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it.each(themes)("%s: status badge text meets 4.5:1 on its own background", (_theme, set) => {
    for (const tone of STATUS_TOKENS) {
      expect(contrast(color(set, tone), color(set, `${tone}-bg`)), tone).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(color(set, "--color-text-secondary"), color(set, "--color-neutral-bg"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color(set, "--color-accent-contrast"), color(set, "--color-accent"))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(themes)("%s: status tones are distinct from the interaction-only accent and focus", (_theme, set) => {
    for (const tone of STATUS_TOKENS) {
      expect(color(set, tone).toLowerCase()).not.toBe(color(set, "--color-accent").toLowerCase());
      expect(color(set, tone).toLowerCase()).not.toBe(color(set, "--color-focus").toLowerCase());
    }
  });

  it("documents the accent as interaction-only", () => {
    expect(tokensCss).toMatch(/Accent and focus are INTERACTION-ONLY/);
  });

  it("uses only local system font stacks and loads no remote resource", () => {
    for (const css of [tokensCss, baseCss]) {
      expect(css).not.toMatch(/@import|@font-face|url\(|https?:\/\//i);
    }
    expect(light["--font-ui"]).toMatch(/^system-ui,/);
    expect(light["--font-mono"]).toMatch(/^ui-monospace,/);
  });

  it("defines the spacing scale, restrained radii and motion tokens", () => {
    expect(Object.keys(light).filter((name) => /^--space-\d+$/.test(name))).toHaveLength(11);
    expect(light["--radius-sm"]).toBe("4px");
    expect(light["--radius-md"]).toBe("6px");
    expect(light["--duration-fast"]).toBe("120ms");
    expect(light["--duration-base"]).toBe("200ms");
    expect(light["--sidebar-width"]).toBe("15rem");
  });

  it("base styles provide a visible focus ring, the scroll-lock rule and reduced motion", () => {
    expect(baseCss).toMatch(/:focus-visible\s*\{\s*outline:\s*2px solid var\(--color-focus\);\s*outline-offset:\s*2px;/);
    expect(baseCss).toMatch(/:root\[data-scroll-lock\]\s*\{\s*overflow:\s*hidden;/);
    expect(baseCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
});
