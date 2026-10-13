import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/App";
import { PRIMARY_NAVIGATION } from "../src/shell/navigation";
import { setViewportWidthRem } from "./setup";

function trigger() {
  return screen.getByRole("button", { name: "Open navigation" });
}

// A closed <dialog> is not exposed; select it structurally by the trigger's
// aria-controls reference.
function drawerDialog(): HTMLDialogElement {
  const id = trigger().getAttribute("aria-controls");
  const dialog = id === null ? null : document.getElementById(id);

  if (!(dialog instanceof HTMLDialogElement)) {
    throw new Error("Navigation dialog not found.");
  }

  return dialog;
}

async function openDrawer() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(trigger());
  return { user, dialog: drawerDialog() };
}

// Escape is browser-owned: the browser fires "cancel" and, unless prevented,
// closes the dialog. Reproduce that native sequence.
function nativeEscape(dialog: HTMLDialogElement) {
  const cancel = new Event("cancel", { cancelable: true });
  dialog.dispatchEvent(cancel);

  if (!cancel.defaultPrevented) {
    dialog.close();
  }
}

// Reproduces the browser's close(): `open` is removed and focus restoration
// (whose outcome `restore` supplies) runs synchronously; "close" is then
// dispatched from a queued task, not synchronously as in the jsdom shim.
function emulateNativeClose(restore: () => void) {
  return vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) {
    if (!this.open) {
      return;
    }

    this.removeAttribute("open");
    restore();
    setTimeout(() => this.dispatchEvent(new Event("close")), 0);
  });
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

// The desktop sidebar's Overview link (outside the drawer). jsdom cannot
// apply the >= 64rem rule that displays it, hence hidden: true.
function desktopOverviewLink(dialog: HTMLDialogElement): HTMLElement {
  const link = screen
    .getAllByRole("link", { name: "Overview", hidden: true })
    .find((candidate) => !dialog.contains(candidate));

  if (link === undefined) {
    throw new Error("Desktop Overview link not found.");
  }

  return link;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("navigation model", () => {
  it("contains Overview only (no placeholder destinations)", () => {
    expect(PRIMARY_NAVIGATION.map((item) => item.label)).toEqual(["Overview"]);
  });
});

describe("mobile navigation trigger", () => {
  it("is a named button that controls the dialog and reports its expanded state", async () => {
    const user = userEvent.setup();
    render(<App />);
    const button = trigger();
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-controls")).toBe(drawerDialog().id);

    await user.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");

    await user.click(screen.getByRole("button", { name: "Close navigation" }));
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("NavigationDrawer native dialog contract", () => {
  it("opens with showModal and has the accessible name Navigation", async () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const { dialog } = await openDrawer();
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(dialog.open).toBe(true);
    expect(screen.getByRole("dialog", { name: "Navigation" })).toBe(dialog);
  });

  it("moves initial focus to the Close navigation button", async () => {
    await openDrawer();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close navigation" }));
  });

  it("closes from the close button and returns focus to the trigger", async () => {
    const { user, dialog } = await openDrawer();
    await user.click(within(dialog).getByRole("button", { name: "Close navigation" }));
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(trigger());
  });

  it("keeps React state in sync with a native Escape close and returns focus", async () => {
    const { dialog } = await openDrawer();
    act(() => nativeEscape(dialog));
    expect(dialog.open).toBe(false);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger());
    // Reopening works: no stale open state is left behind.
    fireEvent.click(trigger());
    expect(dialog.open).toBe(true);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
  });

  it("dismisses on a backdrop click (target is the dialog itself)", async () => {
    const { dialog } = await openDrawer();
    fireEvent.click(dialog);
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(trigger());
  });

  it("does not dismiss on clicks inside the drawer panel", async () => {
    const { dialog } = await openDrawer();
    const panel = dialog.firstElementChild;
    expect(panel).not.toBeNull();
    fireEvent.click(panel as Element);
    fireEvent.click(within(dialog).getByRole("navigation", { name: "Primary" }));
    fireEvent.click(within(dialog).getByRole("list"));
    expect(dialog.open).toBe(true);
  });

  it("closes when Overview is selected, without navigating, and returns focus", async () => {
    const { dialog } = await openDrawer();
    const link = within(dialog).getByRole("link", { name: "Overview" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(trigger());
  });

  it("closes when the viewport crosses to >= 64rem and never refocuses the hidden trigger", async () => {
    const { dialog } = await openDrawer();
    const focusTrigger = vi.spyOn(trigger(), "focus");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close navigation" }));

    act(() => setViewportWidthRem(64));

    expect(dialog.open).toBe(false);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(focusTrigger).not.toHaveBeenCalled();
    // Focus left inside the closing dialog moves to the desktop sidebar's
    // Overview link. (jsdom cannot apply the >= 64rem rule that displays the
    // sidebar, hence hidden: true; in a browser it is visible at that width.)
    const sidebarLinks = screen.getAllByRole("link", { name: "Overview", hidden: true });
    expect(sidebarLinks).toHaveLength(1);
    expect(document.activeElement).toBe(sidebarLinks[0]);
  });

  it("moves focus to the visible desktop Overview link after a real-browser close sequence", async () => {
    // Browser close(): focus restoration to the previously focused element
    // runs synchronously, then "close" is dispatched from a queued task. The
    // restoration outcome at >= 64rem varies, so each case is reproduced.
    const restorations: ReadonlyArray<[string, () => void]> = [
      ["left on the hidden trigger", () => trigger().focus()],
      ["dropped to <body>", () => (document.activeElement as HTMLElement).blur()],
      ["left in the closed dialog", () => undefined],
    ];

    for (const [label, restore] of restorations) {
      const close = emulateNativeClose(restore);
      const { dialog } = await openDrawer();
      const desktopLink = desktopOverviewLink(dialog);

      act(() => setViewportWidthRem(64));
      expect(dialog.open, label).toBe(false);
      await act(() => nextTask());

      expect(trigger().getAttribute("aria-expanded"), label).toBe("false");
      expect(document.documentElement.hasAttribute("data-scroll-lock"), label).toBe(false);
      expect(document.activeElement, label).toBe(desktopLink);
      expect(document.activeElement, label).not.toBe(document.body);

      close.mockRestore();
      cleanup();
      act(() => setViewportWidthRem(40));
    }
  });

  it("retries the desktop focus transfer once, on the next frame, if the link is not yet focusable", async () => {
    emulateNativeClose(() => (document.activeElement as HTMLElement).blur());
    const { dialog } = await openDrawer();
    const desktopLink = desktopOverviewLink(dialog);
    // The first attempt runs before the >= 64rem style applies (no-op focus).
    const focusLink = vi.spyOn(desktopLink, "focus").mockImplementationOnce(() => undefined);

    act(() => setViewportWidthRem(64));
    await act(() => nextTask());
    expect(focusLink).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(document.body);

    await act(() => nextFrame());
    expect(focusLink).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(desktopLink);
  });

  it("never steals focus that the browser placed on a visible element outside the drawer", async () => {
    emulateNativeClose(() => screen.getByRole("main").focus());
    const { dialog } = await openDrawer();
    const focusLink = vi.spyOn(desktopOverviewLink(dialog), "focus");

    act(() => setViewportWidthRem(64));
    await act(() => nextTask());
    await act(() => nextFrame());

    expect(focusLink).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  it("cancels a pending desktop focus retry on unmount", async () => {
    emulateNativeClose(() => (document.activeElement as HTMLElement).blur());
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame");
    const { dialog } = await openDrawer();
    const focusLink = vi.spyOn(desktopOverviewLink(dialog), "focus").mockImplementation(() => undefined);

    act(() => setViewportWidthRem(64));
    await act(() => nextTask());
    cleanup();
    await nextFrame();

    expect(focusLink).toHaveBeenCalledTimes(1);
    expect(cancelFrame).toHaveBeenCalled();
  });

  it("keeps trigger focus return for non-viewport closes under the real-browser close sequence", async () => {
    emulateNativeClose(() => trigger().focus());
    const { user, dialog } = await openDrawer();
    const focusLink = vi.spyOn(desktopOverviewLink(dialog), "focus");

    await user.click(within(dialog).getByRole("button", { name: "Close navigation" }));
    await act(() => nextTask());
    await act(() => nextFrame());

    expect(focusLink).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger());
  });

  it("locks background scrolling while open and restores it on every close path", async () => {
    const root = document.documentElement;
    const closers: ReadonlyArray<[string, (dialog: HTMLDialogElement) => void]> = [
      ["button", (dialog) => fireEvent.click(within(dialog).getByRole("button", { name: "Close navigation" }))],
      ["escape", (dialog) => act(() => nativeEscape(dialog))],
      ["backdrop", (dialog) => fireEvent.click(dialog)],
      ["navigation", (dialog) => fireEvent.click(within(dialog).getByRole("link", { name: "Overview" }))],
      ["viewport", () => act(() => setViewportWidthRem(64))],
    ];

    for (const [label, close] of closers) {
      act(() => setViewportWidthRem(40));
      const view = render(<App />);
      expect(root.hasAttribute("data-scroll-lock"), label).toBe(false);
      fireEvent.click(trigger());
      expect(root.getAttribute("data-scroll-lock"), label).toBe("navigation-drawer");
      close(drawerDialog());
      expect(root.hasAttribute("data-scroll-lock"), label).toBe(false);
      view.unmount();
    }
  });

  it("restores a pre-existing scroll-lock value and releases the lock on unmount", async () => {
    const root = document.documentElement;
    root.setAttribute("data-scroll-lock", "pre-existing");
    const view = render(<App />);
    fireEvent.click(trigger());
    expect(root.getAttribute("data-scroll-lock")).toBe("navigation-drawer");
    fireEvent.click(screen.getByRole("button", { name: "Close navigation" }));
    expect(root.getAttribute("data-scroll-lock")).toBe("pre-existing");

    root.removeAttribute("data-scroll-lock");
    fireEvent.click(trigger());
    expect(root.getAttribute("data-scroll-lock")).toBe("navigation-drawer");
    view.unmount();
    expect(root.hasAttribute("data-scroll-lock")).toBe(false);
  });
});
