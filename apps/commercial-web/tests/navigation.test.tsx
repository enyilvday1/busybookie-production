import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderAt } from "./renderAt";
import { setViewportWidthRem } from "./setup";

function primaryNav() {
  return screen.getByRole("navigation", { name: "Primary" });
}

function menuToggle() {
  return screen.getByRole("button", { name: "Menu" });
}

function mobilePanel() {
  const id = menuToggle().getAttribute("aria-controls");
  const panel = id === null ? null : document.getElementById(id);
  expect(panel).not.toBeNull();
  return panel!;
}

describe("site header and primary navigation", () => {
  it("links to the correct routes", () => {
    renderAt("/");
    const nav = within(primaryNav());
    expect(nav.getByRole("link", { name: "Solutions" })).toHaveAttribute("href", "/solutions");
    expect(nav.getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "/pricing");
    expect(screen.getByRole("link", { name: "[Product Name] home" })).toHaveAttribute("href", "/");
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Explore free options" })).toHaveAttribute(
      "href",
      "/#start-options",
    );
  });

  it("marks the current page", () => {
    renderAt("/pricing");
    const nav = within(primaryNav());
    expect(nav.getByRole("link", { name: "Pricing" })).toHaveAttribute("aria-current", "page");
    expect(nav.getByRole("link", { name: "Solutions" })).not.toHaveAttribute("aria-current");
  });

  it("provides a skip link to the main content", () => {
    renderAt("/solutions");
    const skip = screen.getByRole("link", { name: "Skip to main content" });
    expect(skip).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(document.body.querySelector("a")).toBe(skip);
  });

  it("uses the semantic landmarks", () => {
    renderAt("/");
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Footer" })).toBeInTheDocument();
  });
});

describe("mobile navigation", () => {
  it("starts collapsed with the panel hidden", () => {
    renderAt("/");
    expect(menuToggle()).toHaveAttribute("aria-expanded", "false");
    expect(mobilePanel()).not.toBeVisible();
    expect(screen.queryByRole("navigation", { name: "Mobile" })).toBeNull();
  });

  it("opens and closes from the keyboard with Enter and Space", async () => {
    const user = userEvent.setup();
    renderAt("/");

    menuToggle().focus();
    await user.keyboard("{Enter}");
    expect(menuToggle()).toHaveAttribute("aria-expanded", "true");
    expect(mobilePanel()).toBeVisible();

    const mobile = within(screen.getByRole("navigation", { name: "Mobile" }));
    expect(mobile.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(mobile.getByRole("link", { name: "Solutions" })).toHaveAttribute("href", "/solutions");
    expect(mobile.getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "/pricing");
    expect(within(mobilePanel()).getByRole("link", { name: "Explore free options" })).toHaveAttribute(
      "href",
      "/#start-options",
    );

    await user.keyboard(" ");
    expect(menuToggle()).toHaveAttribute("aria-expanded", "false");
    expect(mobilePanel()).not.toBeVisible();
  });

  it("puts the panel links next in the tab order", async () => {
    const user = userEvent.setup();
    renderAt("/");

    menuToggle().focus();
    await user.keyboard("{Enter}");
    await user.tab();
    expect(within(screen.getByRole("navigation", { name: "Mobile" })).getByRole("link", { name: "Home" })).toHaveFocus();
  });

  it("closes on Escape and restores focus to the toggle", async () => {
    const user = userEvent.setup();
    renderAt("/");

    menuToggle().focus();
    await user.keyboard("{Enter}");
    await user.tab();
    expect(menuToggle()).not.toHaveFocus();

    await user.keyboard("{Escape}");
    expect(menuToggle()).toHaveAttribute("aria-expanded", "false");
    expect(mobilePanel()).not.toBeVisible();
    expect(menuToggle()).toHaveFocus();
  });

  it("closes when a panel link is followed", async () => {
    const user = userEvent.setup();
    renderAt("/");

    await user.click(menuToggle());
    await user.click(within(mobilePanel()).getByRole("link", { name: "Explore free options" }));
    expect(menuToggle()).toHaveAttribute("aria-expanded", "false");
  });

  it("closes when the viewport widens to the full-navigation breakpoint", async () => {
    const user = userEvent.setup();
    renderAt("/");

    await user.click(menuToggle());
    expect(menuToggle()).toHaveAttribute("aria-expanded", "true");

    act(() => setViewportWidthRem(64));
    expect(menuToggle()).toHaveAttribute("aria-expanded", "false");
  });

  it("marks the current page in the mobile panel", async () => {
    const user = userEvent.setup();
    renderAt("/solutions");

    await user.click(menuToggle());
    const mobile = within(screen.getByRole("navigation", { name: "Mobile" }));
    expect(mobile.getByRole("link", { name: "Solutions" })).toHaveAttribute("aria-current", "page");
  });
});
