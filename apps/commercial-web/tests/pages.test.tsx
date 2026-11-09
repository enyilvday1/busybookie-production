import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CONTENT_FAMILIES } from "../src/content/siteContent";
import { productIdentity } from "../src/productIdentity";
import { resolveRoute } from "../src/routes";
import { headingLevels, renderAt } from "./renderAt";

const FAMILY_NAMES = [
  "Stories & Publishing",
  "Video & Entertainment",
  "Education & Learning",
  "Characters & Creative IP",
  "Audio & Narration",
  "Marketing & Social Media",
];

function expectSoundHeadingStructure() {
  const levels = headingLevels();
  expect(levels.filter((level) => level === 1)).toHaveLength(1);
  expect(levels[0]).toBe(1);

  for (let index = 1; index < levels.length; index += 1) {
    // A heading may go back up any number of levels but never skip one down.
    expect(levels[index]! - levels[index - 1]!).toBeLessThanOrEqual(1);
  }
}

function expectNoDeadOrCommerceLinks() {
  for (const link of document.querySelectorAll("a")) {
    const href = link.getAttribute("href") ?? "";
    expect(href).not.toBe("");
    expect(href).not.toBe("#");
    expect(href).not.toMatch(/signup|sign-up|register|checkout|login|account/i);

    // In-page fragments must point at an element that exists.
    const fragment = href.includes("#") ? href.slice(href.indexOf("#") + 1) : "";
    const samePage = href.startsWith("#") || href.split("#")[0] === window.location.pathname;
    if (fragment !== "" && samePage) {
      expect(document.getElementById(fragment), `target of ${href}`).not.toBeNull();
    }
  }
}

const FAMILY_IMAGE_FILES: Record<string, string> = {
  "Stories & Publishing": "stories-publishing.webp",
  "Video & Entertainment": "video-entertainment.webp",
  "Education & Learning": "education-learning.webp",
  "Characters & Creative IP": "characters-creative-ip.webp",
  "Audio & Narration": "audio-narration.webp",
  "Marketing & Social Media": "marketing-social-media.webp",
};

function expectFamilyImagesInCards() {
  for (const name of FAMILY_NAMES) {
    const card = screen.getByRole("article", { name });
    const images = within(card).getAllByRole("img");
    expect(images, `${name} image`).toHaveLength(1);
    const image = images[0]!;
    expect(image).toHaveAttribute("src", `/images/content-families/${FAMILY_IMAGE_FILES[name]}`);
    expect(image.getAttribute("alt")?.trim().length ?? 0).toBeGreaterThan(20);
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("width");
    expect(image).toHaveAttribute("height");
    expect(image.closest(".family-card__media")).not.toBeNull();
  }
  const sources = [...document.querySelectorAll(".family-card img")].map((image) => image.getAttribute("src"));
  expect(new Set(sources).size).toBe(6);
  for (const src of sources) {
    expect(src).not.toMatch(/^(data:|https?:|\/\/)/);
  }
}

const AUDIENCE_IMAGE_FILES: readonly [string, string][] = [
  ["Independent Creators", "independent-creators.webp"],
  ["Publishers", "publishers.webp"],
  ["Educators", "educators.webp"],
  ["Agencies & Studios", "agencies-studios.webp"],
  ["Family & Character Brands", "family-character-brands.webp"],
];

function audienceSection() {
  const section = screen
    .getByRole("heading", { level: 2, name: /Built for (you, your ideas and your creativity|creators and teams making family media)/ })
    .closest("section");
  expect(section).not.toBeNull();
  return section!;
}

describe("route resolution", () => {
  it("resolves exactly the three phase-1 routes", () => {
    expect(resolveRoute("/")?.id).toBe("home");
    expect(resolveRoute("/solutions")?.id).toBe("solutions");
    expect(resolveRoute("/solutions/")?.id).toBe("solutions");
    expect(resolveRoute("/pricing")?.id).toBe("pricing");
    expect(resolveRoute("/index.html")?.id).toBe("home");
    expect(resolveRoute("/signup")).toBeNull();
    expect(resolveRoute("/dashboard")).toBeNull();
  });

  it("renders a not-found state for unknown paths", () => {
    renderAt("/checkout");
    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    expect(document.title).toBe(`Page not found · ${productIdentity.name}`);
  });
});

describe("product identity", () => {
  it("is a clearly replaceable placeholder", () => {
    expect(productIdentity.name).toBe("[Product Name]");
    expect(productIdentity.isProvisional).toBe(true);
  });

  it("supplies the product name in the header and footer", () => {
    renderAt("/");
    expect(within(screen.getByRole("banner")).getByText("[Product Name]")).toBeInTheDocument();
    expect(within(screen.getByRole("contentinfo")).getByText("[Product Name]")).toBeInTheDocument();
  });
});

describe("Home page", () => {
  it("renders the hero, calls to action and title", () => {
    renderAt("/");
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Create children's, educational and family media in one production platform.",
      }),
    ).toBeInTheDocument();
    expect(document.title).toBe("[Product Name]");

    const main = screen.getByRole("main");
    const primary = within(main).getAllByRole("link", { name: /Build your first production free/ });
    expect(primary.length).toBeGreaterThanOrEqual(2);
    for (const link of primary) {
      expect(link).toHaveAttribute("href", "/#start-options");
    }
    expect(within(main).getByRole("link", { name: "See how the workflow works" })).toHaveAttribute("href", "#workflow");
  });

  it("keeps the hero copy, both calls to action and the live preview inside the hero", () => {
    renderAt("/");
    const hero = screen.getByRole("heading", { level: 1 }).closest("section");
    expect(hero).not.toBeNull();
    const inHero = within(hero!);

    expect(inHero.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Create children's, educational and family media in one production platform.",
    );
    expect(hero!.querySelector(".hero__eyebrow")).toHaveTextContent(
      "Stories, video, education, activities, audio, character IP and branded content.",
    );
    expect(inHero.getByRole("link", { name: /Build your first production free/ })).toHaveAttribute(
      "href",
      "/#start-options",
    );
    expect(inHero.getByRole("link", { name: "See how the workflow works" })).toHaveAttribute("href", "#workflow");

    // The preview stays live HTML, not a picture: no images, canvas or video in the hero.
    const preview = inHero.getByRole("figure");
    expect(within(preview).getByText("Conceptual product preview")).toBeInTheDocument();
    expect(preview).toHaveTextContent("The Lantern Fox");
    expect(hero!.querySelectorAll("img, picture, canvas, video, iframe")).toHaveLength(0);
  });

  it("mentions every output type in the hero support copy", () => {
    renderAt("/");
    const lead = document.querySelector(".hero__lead")?.textContent ?? "";
    for (const term of ["stories", "characters", "video", "audio", "printables", "branded content", "production assets"]) {
      expect(lead.toLowerCase()).toContain(term);
    }
  });

  it("labels the product demonstration as a conceptual preview", () => {
    renderAt("/");
    const figure = screen.getByRole("figure");
    expect(within(figure).getByText("Conceptual product preview")).toBeInTheDocument();
    expect(figure).toHaveAccessibleName(/Conceptual preview with a fictional project/);
  });

  it("shows all six content families with activities in publishing and learning", () => {
    renderAt("/");
    expect(CONTENT_FAMILIES.map((family) => family.name)).toEqual(FAMILY_NAMES);
    for (const name of FAMILY_NAMES) {
      expect(screen.getByRole("heading", { level: 3, name })).toBeInTheDocument();
    }

    const stories = screen.getByRole("article", { name: "Stories & Publishing" });
    expect(within(stories).getByText("Colouring pages")).toBeInTheDocument();
    const learning = screen.getByRole("article", { name: "Education & Learning" });
    expect(within(learning).getByText("Worksheets")).toBeInTheDocument();
    expect(within(learning).getByText("Puzzles & mazes")).toBeInTheDocument();
  });

  it("shows the approved local image in each content-family card", () => {
    renderAt("/");
    expectFamilyImagesInCards();
  });

  it("shows the five approved audience images in the original audience order", () => {
    renderAt("/");
    const section = audienceSection();
    const cards = within(section).getAllByRole("article");
    expect(cards.map((card) => within(card).getByRole("heading", { level: 3 }).textContent)).toEqual(
      AUDIENCE_IMAGE_FILES.map(([title]) => title),
    );

    const images = within(section).getAllByRole("img");
    expect(images).toHaveLength(5);
    cards.forEach((card, index) => {
      const [title, file] = AUDIENCE_IMAGE_FILES[index]!;
      const cardImages = within(card).getAllByRole("img");
      expect(cardImages, `${title} image`).toHaveLength(1);
      const image = cardImages[0]!;
      const src = image.getAttribute("src") ?? "";
      expect(src).toBe(`/images/audience/${file}`);
      expect(src).not.toMatch(/^(data:|https?:|\/\/)/);
      const alt = image.getAttribute("alt") ?? "";
      expect(alt.trim().length).toBeGreaterThan(30);
      // Alt describes the scene; it does not just repeat the card title.
      expect(alt).not.toBe(title);
      expect(image).toHaveAttribute("loading", "lazy");
      expect(image).toHaveAttribute("decoding", "async");
      expect(image).toHaveAttribute("width");
      expect(image).toHaveAttribute("height");
    });
    expect(new Set(images.map((image) => image.getAttribute("src"))).size).toBe(5);
  });

  it("shows the integrated workflow in order", () => {
    renderAt("/");
    const workflow = screen.getByRole("list", { name: "From a single brief to every format you need" });
    const titles = within(workflow)
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(titles).toEqual([
      "Idea & brief",
      "Planning",
      "Production assets",
      "Media creation",
      "Shared context",
      "Multiple outputs",
      "Publish-ready assets",
    ]);
    expect(within(workflow).queryByRole("heading", { name: "Export-ready assets" })).toBeNull();
    expect(
      within(workflow).getByText(
        "Organised files prepared for your social channels, publishing platforms, printers and other delivery tools.",
      ),
    ).toBeInTheDocument();
  });

  it("presents both free-entry models in the start-options section", () => {
    renderAt("/");
    const section = document.getElementById("start-options");
    expect(section).not.toBeNull();
    const start = within(section!);

    const byo = start.getByRole("article", { name: "Free BYO Provider" });
    expect(within(byo).getByText("Build your first production free.")).toBeInTheDocument();
    expect(within(byo).getByText(/billed by your provider directly to you/)).toBeInTheDocument();

    const hosted = start.getByRole("article", { name: "Hosted Trial" });
    expect(within(hosted).getByText(/One tightly bounded hosted experience, where available/)).toBeInTheDocument();
    expect(within(hosted).getByText(/Not unlimited, not a recurring monthly allowance/)).toBeInTheDocument();
  });

  it("promises a free first production, not a complete one, in the closing banner", () => {
    renderAt("/");
    const closing = screen.getByRole("heading", { level: 2, name: "Start your first production" }).closest("section");
    expect(closing).not.toBeNull();
    expect(
      within(closing!).getByText(
        "Bring your own provider and build your first production free, or try the bounded hosted experience where available.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("main").textContent ?? "").not.toMatch(/complete production free/i);
  });

  it("uses the approved free-entry and principles wording", () => {
    renderAt("/");
    const start = within(document.getElementById("start-options")!);
    expect(start.getByRole("heading", { level: 2, name: "Two ways to get started" })).toBeInTheDocument();
    expect(document.querySelector("#start-options .section-heading .eyebrow")).toHaveTextContent(/^Free entry$/);
    expect(
      start.getByText(
        "One platform, two complementary entry options. They differ in who pays for generation, so the distinction is stated clearly on each.",
      ),
    ).toBeInTheDocument();

    const principles = screen
      .getByRole("heading", { level: 2, name: "Built around productions, not one-off prompts" })
      .closest("section");
    expect(principles).not.toBeNull();
    // Eyebrows are written in sentence case and rendered uppercase by CSS.
    expect(within(principles!).getByText(/^production-first$/i)).toHaveClass("eyebrow");

    const text = screen.getByRole("main").textContent ?? "";
    expect(text).not.toMatch(/Two ways to start/i);
    expect(text).not.toMatch(/Why a production platform/i);
  });

  it("has sound heading structure and no dead or commerce links", () => {
    renderAt("/");
    expectSoundHeadingStructure();
    expectNoDeadOrCommerceLinks();
  });
});

describe("Solutions page", () => {
  it("renders every required section", () => {
    renderAt("/solutions");
    expect(
      screen.getByRole("heading", { level: 1, name: "One production environment for every format your audience experiences" }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Solutions · [Product Name]");

    expect(screen.getByRole("list", { name: "A connected production journey" })).toBeInTheDocument();
    expect(screen.getByRole("figure")).toHaveAccessibleName(/Conceptual preview/);
    for (const name of FAMILY_NAMES) {
      expect(screen.getByRole("heading", { level: 3, name })).toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { level: 2, name: "The production assets behind every output" })).toBeInTheDocument();
    const infrastructure = screen
      .getByRole("heading", { level: 2, name: "The production assets behind every output" })
      .closest("section");
    expect(infrastructure).not.toBeNull();
    for (const asset of [
      "Templates",
      "Storyboards",
      "Scene & shot plans",
      "Reusable visual assets",
      "Backgrounds & props",
      "Audio & narration",
      "Subtitles",
      "Brand styles",
      "Publish-ready assets",
    ]) {
      expect(within(infrastructure!).getByRole("heading", { level: 3, name: asset })).toBeInTheDocument();
    }
    expect(within(infrastructure!).getByText(/Character references and illustrations/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Built for creators and teams making family media" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Bring your next production into one place" })).toBeInTheDocument();
  });

  it("shows the approved local image in each content-family card", () => {
    renderAt("/solutions");
    expectFamilyImagesInCards();
  });

  it("uses publish-ready terminology consistently and no export-ready wording", () => {
    renderAt("/solutions");
    const journey = screen.getByRole("list", { name: "A connected production journey" });
    expect(within(journey).getByRole("heading", { level: 3, name: "Publish-ready assets" })).toBeInTheDocument();

    const infrastructure = screen
      .getByRole("heading", { level: 2, name: "The production assets behind every output" })
      .closest("section");
    expect(infrastructure).not.toBeNull();
    const assetHeading = within(infrastructure!).getByRole("heading", { level: 3, name: "Publish-ready assets" });
    expect(assetHeading.closest(".asset-card")).toHaveTextContent(
      "Organised files prepared for your social channels, publishing platforms, printers and other delivery tools.",
    );

    expect(document.body.textContent ?? "").not.toMatch(/export-ready/i);
  });

  it("labels the audience section with the approved wording", () => {
    renderAt("/solutions");
    const section = audienceSection();
    expect(section.querySelector(".section-heading .eyebrow")).toHaveTextContent(/^Built for creative work$/);
    expect(
      within(section).getByText(
        "Primary users are adults: creators, educators and commercial teams producing for children and families.",
      ),
    ).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/Who it is for|people who make family media/);
  });

  it("keeps the stylised audience vignettes in this step", () => {
    renderAt("/solutions");
    const section = audienceSection();
    expect(within(section).getAllByRole("article")).toHaveLength(5);
    expect(within(section).queryAllByRole("img")).toHaveLength(0);
    expect(section.querySelectorAll(".audience-card__vignette")).toHaveLength(5);
  });

  it("ends the shared workflow with publish-ready assets", () => {
    renderAt("/solutions");
    const journey = screen.getByRole("list", { name: "A connected production journey" });
    const steps = within(journey).getAllByRole("listitem");
    expect(steps).toHaveLength(7);
    expect(within(steps[6]!).getByRole("heading", { level: 3 })).toHaveTextContent(/^Publish-ready assets$/);
    expect(within(journey).queryByRole("heading", { name: "Export-ready assets" })).toBeNull();

    const intro = screen.getByText(/^From a creative idea to publish-ready assets/);
    expect(intro.closest("section")).toBe(journey.closest("section"));
    expect(screen.getByRole("main").textContent ?? "").not.toMatch(/From a creative idea to export-ready files/);
  });

  it("marks automated social publishing as planned, not available", () => {
    renderAt("/solutions");
    const note = screen.getByRole("article", { name: "Automated social publishing" });
    expect(within(note).getByText("Planned")).toBeInTheDocument();
    expect(note).toHaveTextContent(/Platforms, availability and timing are not yet confirmed\./);

    const text = note.textContent ?? "";
    expect(text).not.toMatch(/available now|connect your account|schedule now|publish now/i);
    expect(text).not.toMatch(/facebook|instagram|tiktok|youtube|linkedin|pinterest|twitter|\bx\.com\b/i);
    expect(within(note).queryAllByRole("link")).toHaveLength(0);
    expect(within(note).queryAllByRole("button")).toHaveLength(0);

    // It is a roadmap note, not a seventh content family.
    expect(CONTENT_FAMILIES).toHaveLength(6);
    expect(CONTENT_FAMILIES.map((family) => family.name)).not.toContain("Automated social publishing");
  });

  it("has sound heading structure and no dead or commerce links", () => {
    renderAt("/solutions");
    expectSoundHeadingStructure();
    expectNoDeadOrCommerceLinks();
  });
});

describe("Pricing page", () => {
  it("distinguishes provider billing from platform access", () => {
    renderAt("/pricing");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Platform access and generation costs, kept separate");
    expect(document.title).toBe("Pricing · [Product Name]");

    const billing = document.getElementById("billing");
    expect(billing).not.toBeNull();
    const provider = within(billing!).getByRole("article", { name: "Provider billing" });
    expect(within(provider).getByText(/billed directly by your provider/)).toBeInTheDocument();
    const platform = within(billing!).getByRole("article", { name: "Platform access" });
    expect(within(platform).getByText(/scale, workflow and professional delivery/)).toBeInTheDocument();
  });

  it("presents entry choices, provisional professional access and teams", () => {
    renderAt("/pricing");
    const entry = screen.getByRole("heading", { level: 2, name: "Two ways to start" }).closest("section");
    expect(entry).not.toBeNull();
    expect(within(entry!).getByText("Entry choices")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Free ways to start" })).toBeNull();
    expect(screen.getByRole("article", { name: "Free BYO Provider" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Hosted Trial" })).toBeInTheDocument();
    const professionalHeading = screen.getByRole("heading", { level: 2, name: "Professional access" });
    const professional = professionalHeading.closest("section");
    expect(professional).not.toBeNull();
    expect(within(professional!).getByText("To be confirmed")).toBeInTheDocument();
    for (const category of ["Greater scale", "Professional output & delivery", "Deeper workflow capability"]) {
      expect(screen.getByRole("heading", { level: 3, name: category })).toBeInTheDocument();
    }
    const teams = within(professional!).getByRole("article", { name: "Teams & organisations" });
    expect(within(teams).getByRole("heading", { level: 3, name: "Teams & organisations" })).toBeInTheDocument();
    expect(within(teams).getByText("Under consideration")).toBeInTheDocument();
    expect(teams).toHaveTextContent(/Structure, permissions and pricing are to be confirmed\./);
    expect(teams.textContent ?? "").not.toMatch(/enterprise|\bseats?\b|\broles?\b|shared workspaces?|collaborat/i);
    expect(screen.queryByRole("article", { name: "Teams" })).toBeNull();
    expect(screen.queryByRole("article", { name: "Organisation access" })).toBeNull();
    expect(screen.getByRole("main").textContent ?? "").not.toMatch(/enterprise/i);
  });

  it("separates platform charges from provider costs in the comparison table", () => {
    renderAt("/pricing");
    const row = screen.getByRole("rowheader", { name: "Platform charge" }).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row!).getAllByRole("cell")[0]).toHaveTextContent(/^No platform charge for your first production$/);
  });

  it("leaves every unresolved comparison value explicitly unconfirmed", () => {
    renderAt("/pricing");
    const table = screen.getByRole("table");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((header) => header.textContent);
    expect(headers).toEqual(["Free BYO Provider", "Hosted Trial", "Professional access"]);

    for (const row of within(table).getAllByRole("row").slice(1)) {
      const cells = within(row).getAllByRole("cell");
      expect(cells).toHaveLength(3);
      // Professional access has no decided terms: every value must say so.
      expect(cells[2]).toHaveTextContent(/^To be confirmed$/);
    }
    expect(table.textContent ?? "").not.toMatch(/\d/);
    expect(within(table).queryAllByRole("img")).toHaveLength(0);
  });

  it("keeps the Hosted Trial availability-dependent wherever it is described", () => {
    renderAt("/pricing");
    const hosted = screen.getByRole("article", { name: "Hosted Trial" });
    expect(
      within(hosted).getByText("Platform-covered generation may be available in a tightly bounded trial"),
    ).toBeInTheDocument();
    const unlimited = screen.getByRole("heading", { level: 3, name: "Is unlimited hosted generation included?" });
    expect(unlimited.nextElementSibling?.textContent).toMatch(/^No\. /);
    expect(screen.getByRole("main").textContent ?? "").not.toMatch(/guaranteed (access|trial|eligibility)/i);
  });

  it("uses the approved billing, professional-access and closing wording", () => {
    renderAt("/pricing");
    const billingHeading = screen.getByRole("heading", {
      level: 2,
      name: "Generation costs and platform access, billed separately",
    });
    expect(billingHeading.closest("section")).toBe(document.getElementById("billing"));
    expect(document.querySelector("#billing .section-heading .eyebrow")).toHaveTextContent(/^Billing distinction$/);

    const professional = screen.getByRole("heading", { level: 2, name: "Professional access" }).closest("section");
    expect(professional).not.toBeNull();
    expect(
      within(professional!).getByText(
        "Future paid access may cover the areas below. Plan names, prices, limits and inclusions are still to be confirmed.",
      ),
    ).toBeInTheDocument();

    const closing = screen.getByRole("heading", { level: 2, name: "Choose your way to get started" }).closest("section");
    expect(closing).not.toBeNull();
    expect(
      within(closing!).getByText(
        "Build your first production with your own provider account, or try the bounded hosted experience where available.",
      ),
    ).toBeInTheDocument();
    expect(within(closing!).getByRole("link", { name: /Build your first production free/ })).toHaveAttribute(
      "href",
      "/#start-options",
    );
    expect(within(closing!).getByRole("link", { name: "Explore solutions" })).toHaveAttribute("href", "/solutions");

    const text = screen.getByRole("main").textContent ?? "";
    expect(text).not.toMatch(/Two different things, billed by different parties/);
    expect(text).not.toMatch(/being shaped around the categories below/);
    expect(text).not.toMatch(/Start free, on terms you can see/);
  });

  it("answers the required FAQ questions", () => {
    renderAt("/pricing");
    for (const question of [
      "Are provider generation costs included?",
      "What does Free BYO Provider mean?",
      "What does Hosted Trial mean?",
      "Is unlimited hosted generation included?",
      "Is final paid pricing available?",
    ]) {
      expect(screen.getByRole("heading", { level: 3, name: question })).toBeInTheDocument();
    }
  });

  it("states no prices, quotas, credits or seat counts", () => {
    renderAt("/pricing");
    const text = screen.getByRole("main").textContent ?? "";
    expect(text).not.toMatch(/[$£€]\s?\d/);
    expect(text).not.toMatch(/\d+\s*(credits?|seats?|minutes?|shots?|per month|\/mo)\b/i);
  });

  it("has sound heading structure and no dead or commerce links", () => {
    renderAt("/pricing");
    expectSoundHeadingStructure();
    expectNoDeadOrCommerceLinks();
  });
});
