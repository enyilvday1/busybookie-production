import { describe, expect, it } from "vitest";

import { PrincipalUnavailableError, resolveActivePrincipalForIdentity } from "../../src/application/resolveActivePrincipal.js";
import type { RuntimePool } from "../../src/database/runtimePool.js";

function pool(rows: object[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const fake: RuntimePool = {
    query: async <Row extends object>(sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: rows as Row[] };
    },
    end: async () => {},
  };
  return { fake, calls };
}

const active = { user_id: "u-1", user_status: "ACTIVE", account_id: "a-1", account_status: "ACTIVE" };

describe("resolveActivePrincipalForIdentity", () => {
  it("resolves by exact issuer and subject in one read-only statement", async () => {
    const { fake, calls } = pool([active]);
    const principal = await resolveActivePrincipalForIdentity(fake, {
      issuer: " https://Issuer.Test/ ",
      subject: "Mixed-Case",
      email: { address: "someone@example.test", verified: true },
    });

    expect(principal).toEqual({ userId: "u-1", accountId: "a-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toEqual([" https://Issuer.Test/ ", "Mixed-Case"]);
    expect(calls[0]!.sql).toMatch(/^\s*SELECT/);
    expect(calls[0]!.sql).not.toMatch(/email|INSERT|UPDATE|DELETE|audit_events/i);
    expect(calls[0]!.sql).toContain("a.kind = 'PERSONAL'");
  });

  it.each([
    ["USER_NOT_FOUND", []],
    ["USER_DISABLED", [{ ...active, user_status: "DISABLED" }]],
    ["ACCOUNT_NOT_FOUND", [{ ...active, account_id: null, account_status: null }]],
    ["ACCOUNT_DISABLED", [{ ...active, account_status: "DISABLED" }]],
  ])("refuses with %s", async (reason, rows) => {
    const { fake } = pool(rows);
    await expect(resolveActivePrincipalForIdentity(fake, { issuer: "i", subject: "s" })).rejects.toMatchObject({ reason });
    await expect(resolveActivePrincipalForIdentity(fake, { issuer: "i", subject: "s" })).rejects.toBeInstanceOf(PrincipalUnavailableError);
  });

  it("uses a generic message", () => {
    expect(new PrincipalUnavailableError("USER_DISABLED").message).toBe("No active account is available for this identity.");
  });
});
