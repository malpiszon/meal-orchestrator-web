import { describe, expect, it } from "vitest";
import { authLinkQuerySchema } from "@/lib/auth-link";

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
