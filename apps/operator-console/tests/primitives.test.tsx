import { render, screen } from "@testing-library/react";
import { Menu } from "lucide-react";
import { describe, expect, it } from "vitest";

import {
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  PageHeader,
  Panel,
  Skeleton,
  STATUS_TONES,
  StatusIndicator,
  VisuallyHidden,
} from "../src/design-system";

describe("Button and IconButton", () => {
  it("renders a type=button control named by its text", () => {
    render(<Button variant="primary">Save view</Button>);
    const button = screen.getByRole("button", { name: "Save view" });
    expect(button.getAttribute("type")).toBe("button");
  });

  it("exposes native disabled semantics", () => {
    render(<Button disabled>Unavailable</Button>);
    expect((screen.getByRole("button", { name: "Unavailable" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("names icon-only controls by label and hides the icon from assistive technology", () => {
    const { container } = render(<IconButton label="Open menu" icon={Menu} />);
    const button = screen.getByRole("button", { name: "Open menu" });
    expect(button.getAttribute("aria-label")).toBe("Open menu");
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("StatusIndicator", () => {
  it("has exactly the five frozen tones and no accent tone", () => {
    expect([...STATUS_TONES]).toEqual(["neutral", "info", "success", "warning", "danger"]);
  });

  it.each(STATUS_TONES)("always renders its text label for tone %s, with a decorative icon", (tone) => {
    const { container } = render(<StatusIndicator tone={tone} label={`Label for ${tone}`} />);
    expect(screen.getByText(`Label for ${tone}`)).toBeTruthy();
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.firstElementChild?.getAttribute("data-tone")).toBe(tone);
  });
});

describe("structural primitives", () => {
  it("PageHeader renders one h1 and an optional description", () => {
    render(<PageHeader title="Episodes" description="Details" />);
    expect(screen.getByRole("heading", { level: 1, name: "Episodes" })).toBeTruthy();
    expect(screen.getByText("Details")).toBeTruthy();
  });

  it("Panel with a title is a labelled region", () => {
    render(
      <Panel title="Summary">
        <p>Body</p>
      </Panel>,
    );
    expect(screen.getByRole("region", { name: "Summary" })).toBeTruthy();
  });

  it("VisuallyHidden keeps text in the accessibility tree", () => {
    render(<VisuallyHidden>Screen reader text</VisuallyHidden>);
    expect(screen.getByText("Screen reader text")).toBeTruthy();
  });

  it("Skeleton is decorative", () => {
    const { container } = render(<Skeleton width="half" />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("loading, empty and error states", () => {
  it("LoadingState announces one polite status sentence and is aria-busy", () => {
    const { container } = render(<LoadingState subject="episodes" />);
    expect(screen.getByRole("status").textContent).toBe("Loading episodes");
    expect(container.firstElementChild?.getAttribute("aria-busy")).toBe("true");
    expect(container.textContent).not.toMatch(/%/);
  });

  it("EmptyState renders exactly its title and description", () => {
    render(<EmptyState title="No items" description="Nothing has been created yet." />);
    expect(screen.getByRole("heading", { level: 2, name: "No items" })).toBeTruthy();
    expect(screen.getByText("Nothing has been created yet.")).toBeTruthy();
  });

  it("ErrorState renders only the safe code, message and request ID as text", () => {
    const { container } = render(
      <ErrorState code="STATE_UNAVAILABLE" message="Production state could not be read." requestId="req-123" />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("STATE_UNAVAILABLE")).toBeTruthy();
    expect(screen.getByText("Production state could not be read.")).toBeTruthy();
    expect(screen.getByText("req-123")).toBeTruthy();
    expect(container.querySelector("button")).toBeNull();
  });

  it("ErrorState renders markup-like input as inert text", () => {
    const { container } = render(<ErrorState code="<b>x</b>" message="<img src=x onerror=alert(1)>" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
  });
});
