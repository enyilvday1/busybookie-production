import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import indexHtml from "../index.html?raw";

// Test-only environment shims. Application code never imports this file.

// The app renders into jsdom's default document, not index.html, so mirror
// the shipped <html lang> onto it. axe's html-has-lang rule then checks the
// real value: a missing lang in index.html still fails.
const shippedLang = /<html[^>]*\slang="([^"]+)"/.exec(indexHtml)?.[1];
if (shippedLang !== undefined) {
  document.documentElement.lang = shippedLang;
}

// A controllable matchMedia supporting min-width queries in rem, so tests can
// simulate crossing the navigation breakpoint as a browser resize would.
type Listener = (event: MediaQueryListEvent) => void;

type MockQuery = {
  minWidthRem: number;
  matches: boolean;
  listeners: Set<Listener>;
  media: string;
};

const queries: MockQuery[] = [];
let viewportWidthRem = 24;

function createQuery(media: string): MediaQueryList {
  const match = /\(min-width:\s*([0-9.]+)rem\)/.exec(media);
  const minWidthRem = match === null ? Number.POSITIVE_INFINITY : Number(match[1]);
  const entry: MockQuery = { minWidthRem, matches: viewportWidthRem >= minWidthRem, listeners: new Set(), media };
  queries.push(entry);

  return {
    media,
    get matches() {
      return entry.matches;
    },
    onchange: null,
    addEventListener: (_type: string, listener: Listener) => entry.listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => entry.listeners.delete(listener),
    addListener: (listener: Listener) => entry.listeners.add(listener),
    removeListener: (listener: Listener) => entry.listeners.delete(listener),
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;
}

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  value: createQuery,
});

/** Simulates a viewport resize, notifying listeners whose result flipped. */
export function setViewportWidthRem(widthRem: number): void {
  viewportWidthRem = widthRem;

  for (const query of queries) {
    const next = widthRem >= query.minWidthRem;

    if (next !== query.matches) {
      query.matches = next;
      const event = { matches: next, media: query.media } as MediaQueryListEvent;

      for (const listener of [...query.listeners]) {
        listener(event);
      }
    }
  }
}

afterEach(() => {
  cleanup();
  queries.length = 0;
  viewportWidthRem = 24;
  window.history.replaceState(null, "", "/");
  document.title = "";
});
