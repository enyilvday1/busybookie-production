import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/App";
import { OPERATOR_REQUEST_TIMEOUT_MS } from "../src/api/operatorClient";

// End-to-end session behaviour through the real App and client with a
// hand-resolved fetch, so completion order is fully controlled.

const TOKEN = "0123456789abcdef".repeat(4);
const LIST = {
  apiVersion: "v1",
  episodes: [{ episodeId: "EP02", manifest: "VALID", title: "Ollie finds a shell", sceneCount: 1, shotCount: 3 }],
};
const OTHER_LIST = {
  apiVersion: "v1",
  episodes: [{ episodeId: "EP09", manifest: "INVALID" }],
};

type PendingCall = {
  init: RequestInit;
  resolve: (response: Response) => void;
  reject: (error: unknown) => void;
};

// Resolves only when the test says so. Abort is deliberately NOT honoured, so
// a superseded request can still "complete" late, as a real race would.
function controllableFetch() {
  const calls: PendingCall[] = [];
  const fetchMock = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        calls.push({ init: init ?? {}, resolve, reject });
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function errorEnvelope(code: string) {
  return { error: { code, message: "backend detail", requestId: "aed7ef66-15f4-48e7-8c37-6d28fa204f09" } };
}

function tokenField() {
  return screen.getByLabelText("Operator token") as HTMLInputElement;
}

async function unlock(user: ReturnType<typeof userEvent.setup>, token = TOKEN) {
  await user.type(tokenField(), token);
  await user.click(screen.getByRole("button", { name: "Connect" }));
}

async function settle(call: PendingCall | undefined, response: Response | Error) {
  await act(async () => {
    if (response instanceof Error) {
      call?.reject(response);
    } else {
      call?.resolve(response);
    }
    await Promise.resolve();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function isLocked() {
  return screen.queryByLabelText("Operator token") !== null;
}

let storageSpies: Array<ReturnType<typeof vi.spyOn>>;
let consoleSpies: Array<ReturnType<typeof vi.spyOn>>;
let idbOpen: ReturnType<typeof vi.fn>;
let cachesOpen: ReturnType<typeof vi.fn>;

beforeEach(() => {
  storageSpies = [
    vi.spyOn(Storage.prototype, "setItem"),
    vi.spyOn(Storage.prototype, "getItem"),
    vi.spyOn(window.history, "pushState"),
    vi.spyOn(window.history, "replaceState"),
    vi.spyOn(Document.prototype, "cookie", "set"),
  ];
  consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method));
  idbOpen = vi.fn();
  cachesOpen = vi.fn();
  vi.stubGlobal("indexedDB", { open: idbOpen });
  vi.stubGlobal("caches", { open: cachesOpen });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function expectNothingPersisted() {
  for (const spy of storageSpies) {
    expect(spy).not.toHaveBeenCalled();
  }
  for (const spy of consoleSpies) {
    for (const call of spy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(TOKEN);
    }
  }
  expect(idbOpen).not.toHaveBeenCalled();
  expect(cachesOpen).not.toHaveBeenCalled();
  expect(window.location.href).not.toContain(TOKEN);
  expect(document.documentElement.outerHTML).not.toContain(TOKEN);
}

describe("locked start and unlock", () => {
  it("starts LOCKED, makes no request and does not steal focus", () => {
    const { fetchMock } = controllableFetch();
    render(<App />);
    expect(isLocked()).toBe(true);
    expect(screen.getByRole("heading", { level: 2, name: "Connect to the operator server" })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  it("uses an uncontrolled password field with the frozen attributes", () => {
    controllableFetch();
    render(<App />);
    const field = tokenField();
    expect(field.type).toBe("password");
    expect(field.getAttribute("autocomplete")).toBe("off");
    expect(field.getAttribute("spellcheck")).toBe("false");
    expect(field.getAttribute("autocapitalize")).toBe("off");
    expect(field.getAttribute("autocorrect")).toBe("off");
    expect(field.hasAttribute("name")).toBe(false);
    expect(field.hasAttribute("value")).toBe(false);
  });

  it("refuses an empty or whitespace token without any request", async () => {
    const { fetchMock } = controllableFetch();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByText("Enter the operator token.")).toBeTruthy();
    expect(tokenField().getAttribute("aria-invalid")).toBe("true");
    await unlock(user, "   ");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(isLocked()).toBe(true);
  });

  it("trims the token, clears the field, sends one bearer request and focuses main", async () => {
    const { fetchMock, calls } = controllableFetch();
    const user = userEvent.setup();
    render(<App />);
    const field = tokenField();
    await unlock(user, `  ${TOKEN}\n`);
    expect(field.value).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/v1/operator/episodes");
    expect(calls[0]!.init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
    expect(document.activeElement).toBe(screen.getByRole("main"));
    expect(screen.getByText("Loading episodes")).toBeTruthy();
    await settle(calls[0], json(200, LIST));
    expect(screen.getByRole("table")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("main"));
    expectNothingPersisted();
  });
});

describe("session destruction", () => {
  it("Lock destroys the session, aborts the request and focuses the token field", async () => {
    const { calls } = controllableFetch();
    const user = userEvent.setup();
    render(<App />);
    await unlock(user);
    await user.click(screen.getByRole("button", { name: "Lock" }));
    expect(isLocked()).toBe(true);
    expect(calls[0]!.init.signal?.aborted).toBe(true);
    expect(document.activeElement).toBe(tokenField());
    expect(screen.queryByRole("alert")).toBeNull();
    expectNothingPersisted();
  });

  it("a late completion after Lock cannot repopulate the UI", async () => {
    const { calls } = controllableFetch();
    const user = userEvent.setup();
    render(<App />);
    await unlock(user);
    await user.click(screen.getByRole("button", { name: "Lock" }));
    await settle(calls[0], json(200, LIST));
    expect(isLocked()).toBe(true);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("EP02")).toBeNull();
  });

  it("a current 401 on the first request locks with the notice and focuses the field", async () => {
    const { calls } = controllableFetch();
    const user = userEvent.setup();
    render(<App />);
    await unlock(user);
    await settle(calls[0], json(401, errorEnvelope("UNAUTHORIZED")));
    expect(isLocked()).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe(
      "The token was not accepted. Tokens are valid only for the current server launch.",
    );
    expect(document.activeElement).toBe(tokenField());
  });

  it("a current 401 on Refresh locks the session", async () => {
    const { calls } = controllableFetch();
    const user = userEvent.setup();
    render(<App />);
    await unlock(user);
    await settle(calls[0], json(200, LIST));
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await settle(calls[1], json(401, errorEnvelope("UNAUTHORIZED")));
    expect(isLocked()).toBe(true);
    expect(screen.queryByText("EP02")).toBeNull();
  });

  it("a stale 401 from a superseded request cannot end the current session", async () => {
    const { calls } = controllableFetch();
    const user = userEvent.setup();
    render(<App />);
    await unlock(user);
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await settle(calls[0], json(401, errorEnvelope("UNAUTHORIZED")));
    expect(isLocked()).toBe(false);
    await settle(calls[1], json(200, LIST));
    expect(isLocked()).toBe(false);
    expect(screen.getByText("EP02")).toBeTruthy();
  });

  it("reload (a new App) always starts LOCKED with no request", async () => {
    const { fetchMock, calls } = controllableFetch();
    const user = userEvent.setup();
    const first = render(<App />);
    await unlock(user);
    await settle(calls[0], json(200, LIST));
    first.unmount();
    render(<App />);
    expect(isLocked()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("non-auth failures keep the session", () => {
  it.each<[string, () => Response | Error]>([
    ["403 (Host/Origin policy)", () => json(403, errorEnvelope("FORBIDDEN"))],
    ["400", () => json(400, errorEnvelope("BAD_REQUEST"))],
    ["404", () => json(404, errorEnvelope("NOT_FOUND"))],
    ["500", () => json(500, errorEnvelope("INTERNAL_ERROR"))],
    ["503", () => json(503, errorEnvelope("STATE_UNAVAILABLE"))],
    ["a network failure", () => new TypeError("Failed to fetch")],
    ["malformed JSON", () => new Response("{", { status: 200, headers: { "Content-Type": "application/json" } })],
    ["an unrecognized document", () => json(200, { apiVersion: "v9" })],
  ])("%s on the first request and on Refresh retains the client", async (_label, failure) => {
    const { fetchMock, calls } = controllableFetch();
    const user = userEvent.setup();
    render(<App />);
    await unlock(user);
    await settle(calls[0], failure());
    expect(isLocked()).toBe(false);
    expect(screen.getByRole("alert")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await settle(calls[1], failure());
    expect(isLocked()).toBe(false);

    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await settle(calls[2], json(200, LIST));
    expect(screen.getByText("EP02")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of calls) {
      expect(call.init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
    }
  });

  it("a genuine 30 s timeout keeps the session", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    await unlock(user);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OPERATOR_REQUEST_TIMEOUT_MS);
    });
    expect(isLocked()).toBe(false);
    expect(screen.getByText("The operator server did not respond in time.")).toBeTruthy();
    expect(within(screen.getByRole("alert")).getByText("TIMEOUT")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
