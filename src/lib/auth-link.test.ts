import { describe, expect, it } from "vitest";
import { authLinkQuerySchema, authLinkRoute } from "@/lib/auth-link";
import { SET_PASSWORD_PATH } from "@/lib/set-password";

describe("authLinkQuerySchema", () => {
  it.each(["invite", "recovery"])('accepts type "%s"', (type) => {
    const result = authLinkQuerySchema.safeParse({ token_hash: "abc123", type });
    expect(result.error?.issues).toBeUndefined();
    expect(result.data).toEqual({ token_hash: "abc123", type });
  });

  it("rejects a missing token_hash", () => {
    expect(authLinkQuerySchema.safeParse({ type: "invite" }).success).toBe(false);
  });

  it("rejects an empty token_hash", () => {
    expect(authLinkQuerySchema.safeParse({ token_hash: "", type: "invite" }).success).toBe(false);
  });

  it("rejects a missing type", () => {
    expect(authLinkQuerySchema.safeParse({ token_hash: "abc123" }).success).toBe(false);
  });

  it.each(["signup", "magiclink", "email_change", "email"])('rejects type "%s"', (type) => {
    expect(authLinkQuerySchema.safeParse({ token_hash: "abc123", type }).success).toBe(false);
  });
});

describe("authLinkRoute", () => {
  it("verifies an invitation and sends it to the dashboard", () => {
    expect(authLinkRoute({ token_hash: "abc123", type: "invite" })).toEqual({ verify: true, location: "/dashboard" });
  });

  it("forwards a reset link to the set-password page without verifying it", () => {
    const route = authLinkRoute({ token_hash: "abc 123+/", type: "recovery" });
    expect(route.verify).toBe(false);
    const url = new URL(route.location, "http://localhost");
    expect(url.pathname).toBe(SET_PASSWORD_PATH);
    expect(Object.fromEntries(url.searchParams)).toEqual({ token_hash: "abc 123+/", type: "recovery" });
  });
});
