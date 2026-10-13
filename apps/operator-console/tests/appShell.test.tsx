import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "../src/App";
import { productIdentity } from "../src/productIdentity";

describe("application shell", () => {
  // jsdom applies the stylesheets but cannot evaluate the min-width media
  // query, so the shell renders in its narrow (< 64rem) layout here: the
  // sidebar is display:none and the drawer is closed.
  it("has one banner and one main, and exposes at most one primary navigation", () => {
    render(<App />);
    expect(screen.getAllByRole("banner")).toHaveLength(1);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    // One navigation in the DOM (the sidebar); none exposed while the narrow
    // layout hides the sidebar and the drawer is closed.
    expect(screen.getAllByRole("navigation", { name: "Primary", hidden: true })).toHaveLength(1);
    expect(screen.queryAllByRole("navigation", { name: "Primary" })).toHaveLength(0);
  });

  it("exposes exactly one primary navigation (the drawer's) while the drawer is open", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    const exposed = screen.getAllByRole("navigation", { name: "Primary" });
    expect(exposed).toHaveLength(1);
    expect(exposed[0]?.closest("dialog")).not.toBeNull();
  });

  it("has exactly one h1, the Overview heading", () => {
    render(<App />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe("Overview");
  });

  it("puts the skip link first in tab order and moves focus to main", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.tab();
    const skipLink = screen.getByRole("link", { name: "Skip to main content" });
    expect(document.activeElement).toBe(skipLink);
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  it("shows the presentation-only product identity and the deployment-mode badges", () => {
    render(<App />);
    const banner = screen.getByRole("banner");
    expect(within(banner).getByText(productIdentity.productName)).toBeTruthy();
    expect(within(banner).getByText(productIdentity.consoleName)).toBeTruthy();
    expect(within(banner).getByText("Local")).toBeTruthy();
    expect(within(banner).getByText("Read-only")).toBeTruthy();
  });

  it("renders the exact frozen Overview empty-state copy and no call to action", () => {
    render(<App />);
    const main = screen.getByRole("main");
    expect(within(main).getByRole("heading", { level: 2 }).textContent).toBe("Production views aren't connected yet");
    expect(
      within(main).getByText(
        "This interface foundation is ready. Episode and production data will appear here after the read-only operator connection is introduced in the next milestone.",
      ),
    ).toBeTruthy();
    expect(within(main).queryAllByRole("button")).toHaveLength(0);
    expect(within(main).queryAllByRole("link")).toHaveLength(0);
  });

  it("offers Overview as the only navigation destination, marked as the current page", () => {
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Primary", hidden: true });
    const links = within(nav).getAllByRole("link", { hidden: true });
    expect(links.map((link) => link.textContent)).toEqual(["Overview"]);
    expect(links[0]?.getAttribute("aria-current")).toBe("page");
    expect(nav.textContent).not.toMatch(/episode|generation|dialogue|automation|rough cut|settings|admin/i);
  });

  it("never claims production truth anywhere in the rendered shell", () => {
    const { container } = render(<App />);
    expect(container.textContent).not.toMatch(
      /\b(healthy|completed?|finished|ready to publish|loaded|0 episodes|no episodes|unavailable|automation (is )?active)\b/i,
    );
  });
});
