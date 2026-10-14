import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ListEpisodesResult, OperatorClient } from "../src/api/operatorClient";
import type { EpisodeListItem } from "../src/api/operatorDtos";
import { FAILURE_MESSAGES, OverviewPage } from "../src/pages/OverviewPage";

// Overview behaviour against a fake client whose results are resolved by the
// test and which ignores abort, so request-authority rules are exercised by
// the page itself.

const REQUEST_ID = "aed7ef66-15f4-48e7-8c37-6d28fa204f09";
const EPISODES: readonly EpisodeListItem[] = [
  { episodeId: "EP02", manifest: "VALID", title: "Ollie finds a shell", sceneCount: 2, shotCount: 7 },
  { episodeId: "EP03", manifest: "INVALID" },
  { episodeId: "EP10", manifest: "VALID", title: "Tide pools", sceneCount: 1, shotCount: 4 },
];

type Pending = { signal: AbortSignal; resolve: (result: ListEpisodesResult) => void };

function fakeClient() {
  const pending: Pending[] = [];
  const listEpisodes = vi.fn(
    (signal: AbortSignal) =>
      new Promise<ListEpisodesResult>((resolve) => {
        pending.push({ signal, resolve });
      }),
  );
  const client: OperatorClient = Object.freeze({ listEpisodes });
  return { client, listEpisodes, pending };
}

function renderOverview() {
  const fake = fakeClient();
  const onLock = vi.fn();
  const onUnauthorized = vi.fn();
  const view = render(<OverviewPage client={fake.client} onLock={onLock} onUnauthorized={onUnauthorized} />);
  return { ...fake, onLock, onUnauthorized, view };
}

async function complete(entry: Pending | undefined, result: ListEpisodesResult) {
  await act(async () => {
    entry?.resolve(result);
    await Promise.resolve();
  });
}

const ok = (episodes: readonly EpisodeListItem[] = EPISODES): ListEpisodesResult => ({ ok: true, episodes });

afterEach(() => {
  vi.useRealTimers();
});

describe("Overview states", () => {
  it("starts LOADING with one request, busy semantics and the Overview heading", () => {
    const { listEpisodes, view } = renderOverview();
    expect(listEpisodes).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Overview");
    expect(screen.getByRole("status").textContent).toBe("Loading episodes");
    expect(view.container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText(/Retrieved at/)).toBeNull();
  });

  it("renders the exact table in server order without re-sorting", async () => {
    const { pending, view } = renderOverview();
    await complete(pending[0], ok());
    const table = screen.getByRole("table");
    expect(within(table).getByText("Episodes", { selector: "caption" })).toBeTruthy();
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Episode",
      "Title",
      "Scenes",
      "Shots",
      "Manifest",
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0]?.textContent)).toEqual(["EP02", "EP03", "EP10"]);
    expect(within(rows[0]!).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      "EP02",
      "Ollie finds a shell",
      "2",
      "7",
      "Valid",
    ]);
    expect(view.container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.getByText(/^Retrieved at /)).toBeTruthy();
  });

  it("shows INVALID rows as not available with a warning manifest label, and VALID as neutral", async () => {
    const { pending } = renderOverview();
    await complete(pending[0], ok());
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    const invalidCells = within(rows[1]!).getAllByRole("cell");
    for (const cell of invalidCells.slice(1, 4)) {
      expect(cell.textContent).toBe("—Not available");
      expect(within(cell).getByText("—").getAttribute("aria-hidden")).toBe("true");
    }
    const invalidStatus = within(invalidCells[4]!).getByText("Invalid").parentElement;
    expect(invalidStatus?.getAttribute("data-tone")).toBe("warning");
    const validStatus = within(within(rows[0]!).getAllByRole("cell")[4]!).getByText("Valid").parentElement;
    expect(validStatus?.getAttribute("data-tone")).toBe("neutral");
  });

  it.each<[readonly EpisodeListItem[], string]>([
    [[EPISODES[0]!], "1 episode"],
    [[EPISODES[0]!, EPISODES[2]!], "2 episodes"],
    [EPISODES, "3 episodes · 1 with an invalid manifest"],
  ])("summarises the list (%#)", async (episodes, summary) => {
    const { pending } = renderOverview();
    await complete(pending[0], ok(episodes));
    expect(screen.getByRole("status").textContent).toBe(summary);
  });

  it("shows the frozen EMPTY state for an empty list", async () => {
    const { pending } = renderOverview();
    await complete(pending[0], ok([]));
    expect(screen.getByRole("heading", { level: 2, name: "No episodes" })).toBeTruthy();
    expect(screen.getByText("No episodes were found in this production.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it.each([
    ["FORBIDDEN", "FORBIDDEN"],
    ["STATE_UNAVAILABLE", "STATE_UNAVAILABLE"],
    ["SERVER_ERROR", "INTERNAL_ERROR"],
    ["UNEXPECTED_RESPONSE", "NOT_FOUND"],
  ] as const)("shows %s with its frozen message, the allowlisted code and the request ID", async (failure, code) => {
    const { pending } = renderOverview();
    await complete(pending[0], { ok: false, failure, code, requestId: REQUEST_ID });
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText(FAILURE_MESSAGES[failure])).toBeTruthy();
    expect(within(alert).getByText(code)).toBeTruthy();
    expect(within(alert).getByText(REQUEST_ID)).toBeTruthy();
  });

  it.each(["NETWORK", "TIMEOUT", "UNREADABLE_RESPONSE", "UNRECOGNIZED_DATA", "SERVER_ERROR"] as const)(
    "shows %s with the frontend identifier as code when no backend code exists",
    async (failure) => {
      const { pending } = renderOverview();
      await complete(pending[0], { ok: false, failure });
      const alert = screen.getByRole("alert");
      expect(within(alert).getByText(FAILURE_MESSAGES[failure])).toBeTruthy();
      expect(within(alert).getByText(failure)).toBeTruthy();
      expect(within(alert).queryByText("Request ID")).toBeNull();
    },
  );

  it("uses the exact frozen failure copy", () => {
    expect(FAILURE_MESSAGES).toEqual({
      FORBIDDEN: "This console must be opened from the address printed by the operator server.",
      STATE_UNAVAILABLE: "Production state could not be read.",
      SERVER_ERROR: "The operator server reported an internal error.",
      UNEXPECTED_RESPONSE: "The operator server returned an unexpected response.",
      NETWORK: "The operator server could not be reached.",
      TIMEOUT: "The operator server did not respond in time.",
      UNREADABLE_RESPONSE: "The operator server returned an unreadable response.",
      UNRECOGNIZED_DATA: "The operator server returned data this console does not recognise.",
    });
  });

  it("a current 401 hands the session back to the owner and renders no error", async () => {
    const { pending, client, onUnauthorized } = renderOverview();
    await complete(pending[0], { ok: false, failure: "UNAUTHORIZED", code: "UNAUTHORIZED" });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledWith(client);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("request authority", () => {
  it("Refresh while loading supersedes the request and keeps focus on an enabled Refresh", async () => {
    const user = userEvent.setup();
    const { pending, listEpisodes } = renderOverview();
    const refresh = screen.getByRole("button", { name: "Refresh" });
    await user.click(refresh);
    expect(listEpisodes).toHaveBeenCalledTimes(2);
    expect(pending[0]!.signal.aborted).toBe(true);
    expect(refresh.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(refresh);
  });

  it("ignores a stale success", async () => {
    const user = userEvent.setup();
    const { pending } = renderOverview();
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await complete(pending[0], ok([EPISODES[1]!]));
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Loading episodes");
    await complete(pending[1], ok([EPISODES[0]!]));
    expect(screen.getByText("EP02")).toBeTruthy();
    expect(screen.queryByText("EP03")).toBeNull();
  });

  it("ignores a stale error", async () => {
    const user = userEvent.setup();
    const { pending } = renderOverview();
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await complete(pending[1], ok());
    await complete(pending[0], { ok: false, failure: "NETWORK" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("ignores a stale 401: it cannot end the current session", async () => {
    const user = userEvent.setup();
    const { pending, onUnauthorized } = renderOverview();
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await complete(pending[0], { ok: false, failure: "UNAUTHORIZED", code: "UNAUTHORIZED" });
    expect(onUnauthorized).not.toHaveBeenCalled();
    await complete(pending[1], ok());
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("only the newest of repeated Refreshes commits", async () => {
    const user = userEvent.setup();
    const { pending, listEpisodes } = renderOverview();
    const refresh = screen.getByRole("button", { name: "Refresh" });
    await user.click(refresh);
    await user.click(refresh);
    await user.click(refresh);
    expect(listEpisodes).toHaveBeenCalledTimes(4);
    await complete(pending[3], ok([EPISODES[2]!]));
    await complete(pending[1], ok([EPISODES[0]!]));
    await complete(pending[2], { ok: false, failure: "SERVER_ERROR" });
    await complete(pending[0], ok([EPISODES[1]!]));
    expect(screen.getByText("EP10")).toBeTruthy();
    expect(screen.queryByText("EP02")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Lock revokes the in-flight request: a late completion changes nothing", async () => {
    const user = userEvent.setup();
    const { pending, onLock, onUnauthorized } = renderOverview();
    await user.click(screen.getByRole("button", { name: "Lock" }));
    expect(onLock).toHaveBeenCalledTimes(1);
    expect(pending[0]!.signal.aborted).toBe(true);
    await complete(pending[0], ok());
    expect(screen.queryByRole("table")).toBeNull();
    await complete(pending[0], { ok: false, failure: "UNAUTHORIZED" });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("a deliberate abort is never shown as a failure", async () => {
    const { pending } = renderOverview();
    await complete(pending[0], { ok: false, failure: "ABORTED" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a failed Refresh leaves no stale rows", async () => {
    const user = userEvent.setup();
    const { pending } = renderOverview();
    await complete(pending[0], ok());
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(screen.queryByRole("table")).toBeNull();
    await complete(pending[1], { ok: false, failure: "STATE_UNAVAILABLE", code: "STATE_UNAVAILABLE" });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("EP02")).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("unmount revokes the in-flight request", () => {
    const { pending, view } = renderOverview();
    view.unmount();
    expect(pending[0]!.signal.aborted).toBe(true);
  });

  it("never repeats a request on its own (no polling, no retry)", async () => {
    vi.useFakeTimers();
    const { pending, listEpisodes } = renderOverview();
    await complete(pending[0], { ok: false, failure: "NETWORK" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    });
    expect(listEpisodes).toHaveBeenCalledTimes(1);
  });
});

describe("no inference beyond the D1 list", () => {
  it("renders no links, detail affordances or production-truth wording", async () => {
    const { pending, view } = renderOverview();
    await complete(pending[0], ok());
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(view.container.textContent).not.toMatch(
      /ready|readiness|progress|complete|%|next action|health|confidence|generat|render|provider|shot state|status:/i,
    );
  });
});
