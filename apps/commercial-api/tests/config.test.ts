import { describe, expect, it } from "vitest";

import { DEFAULT_HOST, DEFAULT_PORT, loadServerConfig, ServerConfigError } from "../src/config.js";

describe("loadServerConfig", () => {
  it("defaults to a loopback development host and port", () => {
    expect(loadServerConfig({})).toEqual({ host: "127.0.0.1", port: 4480, mode: "development" });
    expect(DEFAULT_HOST).toBe("127.0.0.1");
    expect(DEFAULT_PORT).toBe(4480);
  });

  it("does not default to a port used by the other local applications", () => {
    // commercial-web dev/preview and operator-console dev/preview.
    expect([5180, 4180, 5173, 4173]).not.toContain(DEFAULT_PORT);
  });

  it("accepts an explicit valid host and port", () => {
    expect(loadServerConfig({ COMMERCIAL_API_HOST: "0.0.0.0", COMMERCIAL_API_PORT: "8080" })).toEqual({
      host: "0.0.0.0",
      port: 8080,
      mode: "development",
    });
    expect(loadServerConfig({ COMMERCIAL_API_PORT: "1" }).port).toBe(1);
    expect(loadServerConfig({ COMMERCIAL_API_PORT: "65535" }).port).toBe(65535);
  });

  it.each(["", " ", "0", "65536", "99999", "-1", "80.5", "8080 ", " 8080", "1e3", "0x50", "abc", "123456"])(
    "rejects the malformed port %j instead of falling back",
    (value) => {
      expect(() => loadServerConfig({ COMMERCIAL_API_PORT: value })).toThrow(ServerConfigError);
      expect(() => loadServerConfig({ COMMERCIAL_API_PORT: value })).toThrow(
        "COMMERCIAL_API_PORT must be an integer from 1 to 65535.",
      );
    },
  );

  it.each(["", " ", "local host", "host/path", "http://example.test", "a".repeat(254)])(
    "rejects the malformed host %j",
    (value) => {
      expect(() => loadServerConfig({ COMMERCIAL_API_HOST: value })).toThrow(ServerConfigError);
    },
  );

  it("rejects an unknown mode", () => {
    expect(() => loadServerConfig({ COMMERCIAL_API_ENV: "staging" })).toThrow(ServerConfigError);
    expect(() => loadServerConfig({ COMMERCIAL_API_ENV: "" })).toThrow(ServerConfigError);
  });

  it("requires explicit host and port in production mode", () => {
    expect(() => loadServerConfig({ COMMERCIAL_API_ENV: "production" })).toThrow(ServerConfigError);
    expect(() => loadServerConfig({ COMMERCIAL_API_ENV: "production", COMMERCIAL_API_PORT: "8080" })).toThrow(
      ServerConfigError,
    );
    expect(() => loadServerConfig({ COMMERCIAL_API_ENV: "production", COMMERCIAL_API_HOST: "10.0.0.5" })).toThrow(
      ServerConfigError,
    );
    expect(
      loadServerConfig({ COMMERCIAL_API_ENV: "production", COMMERCIAL_API_HOST: "10.0.0.5", COMMERCIAL_API_PORT: "8080" }),
    ).toEqual({ host: "10.0.0.5", port: 8080, mode: "production" });
  });

  it("ignores every key outside its own namespace", () => {
    expect(loadServerConfig({ PORT: "9999", HOST: "0.0.0.0", NODE_ENV: "production" })).toEqual({
      host: "127.0.0.1",
      port: 4480,
      mode: "development",
    });
  });

  it("returns a frozen configuration", () => {
    expect(Object.isFrozen(loadServerConfig({}))).toBe(true);
  });
});
