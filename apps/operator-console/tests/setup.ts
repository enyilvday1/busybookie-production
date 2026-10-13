import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Test-only environment shims for browser behavior jsdom does not implement.
// Application code never imports this file.

// 1. HTMLDialogElement.showModal/close. jsdom reflects `open` but lacks both
//    methods. The shim mirrors the native contract the application relies on:
//    showModal sets `open` (throwing if already open); close clears it and
//    dispatches "close". Native top layer, inertness and Escape handling are
//    browser-owned and are NOT emulated.
const dialogPrototype = HTMLDialogElement.prototype as HTMLDialogElement & {
  showModal?: () => void;
  close?: (returnValue?: string) => void;
};

if (typeof dialogPrototype.showModal !== "function") {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      if (this.open) {
        throw new DOMException("The dialog is already open.", "InvalidStateError");
      }

      this.setAttribute("open", "");
    },
  });
}

if (typeof dialogPrototype.close !== "function") {
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      if (!this.open) {
        return;
      }

      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    },
  });
}

// 2. A controllable matchMedia supporting min-width queries in rem.
type Listener = (event: MediaQueryListEvent) => void;

type MockQuery = {
  minWidthRem: number;
  matches: boolean;
  listeners: Set<Listener>;
  list: MediaQueryList;
};

const queries: MockQuery[] = [];
let viewportWidthRem = 40;

function evaluate(minWidthRem: number): boolean {
  return viewportWidthRem >= minWidthRem;
}

function createQuery(media: string): MediaQueryList {
  const match = /\(min-width:\s*([0-9.]+)rem\)/.exec(media);
  const minWidthRem = match === null ? Number.POSITIVE_INFINITY : Number(match[1]);
  const listeners = new Set<Listener>();
  const entry: MockQuery = { minWidthRem, matches: evaluate(minWidthRem), listeners, list: undefined as never };

  const list = {
    media,
    get matches() {
      return entry.matches;
    },
    onchange: null,
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
    addListener: (listener: Listener) => listeners.add(listener),
    removeListener: (listener: Listener) => listeners.delete(listener),
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;

  entry.list = list;
  queries.push(entry);
  return list;
}

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  value: createQuery,
});

// Changes the simulated viewport width and notifies listeners whose result
// flipped, as a browser would on resize/rotation.
export function setViewportWidthRem(widthRem: number): void {
  viewportWidthRem = widthRem;

  for (const query of queries) {
    const next = evaluate(query.minWidthRem);

    if (next !== query.matches) {
      query.matches = next;
      const event = { matches: next, media: query.list.media } as MediaQueryListEvent;

      for (const listener of [...query.listeners]) {
        listener(event);
      }
    }
  }
}

afterEach(() => {
  cleanup();
  setViewportWidthRem(40);
  document.documentElement.removeAttribute("data-scroll-lock");
});
