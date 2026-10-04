import { describe, expect, it } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  passwordErrorMessage,
  resetRequestSchema,
  setPasswordFormSchema,
  setPasswordLinkSchema,
  setPasswordUrl,
} from "@/lib/set-password";

describe("MIN_PASSWORD_LENGTH", () => {
  it("is 8", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });
});

describe("resetRequestSchema", () => {
  it("accepts a valid email and trims it", () => {
    const result = resetRequestSchema.safeParse({ email: "  you@example.com " });
    expect(result.error?.issues).toBeUndefined();
    expect(result.data).toEqual({ email: "you@example.com" });
  });

  it.each(["", "   ", "not-an-email", "you@", "@example.com", "you@example"])('rejects "%s"', (email) => {
    expect(resetRequestSchema.safeParse({ email }).success).toBe(false);
  });

  it("rejects a missing email", () => {
    expect(resetRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("setPasswordLinkSchema", () => {
  it('accepts type "recovery"', () => {
    const result = setPasswordLinkSchema.safeParse({ token_hash: "abc123", type: "recovery" });
    expect(result.error?.issues).toBeUndefined();
    expect(result.data).toEqual({ token_hash: "abc123", type: "recovery" });
  });

  it.each(["invite", "signup", "magiclink", "email"])('rejects type "%s"', (type) => {
    expect(setPasswordLinkSchema.safeParse({ token_hash: "abc123", type }).success).toBe(false);
  });

  it("rejects a missing type", () => {
    expect(setPasswordLinkSchema.safeParse({ token_hash: "abc123" }).success).toBe(false);
  });

  it("rejects a missing or empty token_hash", () => {
    expect(setPasswordLinkSchema.safeParse({ type: "recovery" }).success).toBe(false);
    expect(setPasswordLinkSchema.safeParse({ token_hash: "", type: "recovery" }).success).toBe(false);
  });
});

describe("setPasswordFormSchema", () => {
  const token = { token_hash: "abc123", type: "recovery" };

  it("rejects a 7-character password", () => {
    expect(setPasswordFormSchema.safeParse({ password: "1234567", ...token }).success).toBe(false);
  });

  it("accepts an 8-character password", () => {
    const result = setPasswordFormSchema.safeParse({ password: "12345678", ...token });
    expect(result.error?.issues).toBeUndefined();
    expect(result.data).toEqual({ password: "12345678", ...token });
  });

  it("accepts a password without token fields (signed-in retry)", () => {
    const result = setPasswordFormSchema.safeParse({ password: "12345678" });
    expect(result.error?.issues).toBeUndefined();
    expect(result.data).toEqual({ password: "12345678" });
  });

  it("rejects token_hash without type", () => {
    expect(setPasswordFormSchema.safeParse({ password: "12345678", token_hash: "abc123" }).success).toBe(false);
  });

  it("rejects type without token_hash", () => {
    expect(setPasswordFormSchema.safeParse({ password: "12345678", type: "recovery" }).success).toBe(false);
  });

  it('rejects type "invite"', () => {
    expect(
      setPasswordFormSchema.safeParse({ password: "12345678", token_hash: "abc123", type: "invite" }).success,
    ).toBe(false);
  });
});

describe("passwordErrorMessage", () => {
  it.each([
    [{ code: "weak_password", status: 422 }, /too weak/],
    [{ code: "same_password", status: 422 }, /different from your current/],
    [{ code: "over_email_send_rate_limit", status: 429 }, /Too many requests/],
    [{ status: 429 }, /Too many requests/],
  ])("maps %o", (error, expected) => {
    expect(passwordErrorMessage(error)).toMatch(expected);
  });

  it.each([[{ code: "unexpected_failure", status: 500 }], [{}], [null], [undefined]])(
    "falls back to a generic message for %o",
    (error) => {
      expect(passwordErrorMessage(error)).toBe("Something went wrong. Please try again.");
    },
  );
});

describe("setPasswordUrl", () => {
  it("is the bare page without a link or error", () => {
    expect(setPasswordUrl()).toBe("/auth/set-password");
  });

  it("carries the link's token and an error", () => {
    const url = new URL(
      setPasswordUrl({ link: { token_hash: "abc 123", type: "recovery" }, error: "Too short" }),
      "http://localhost",
    );
    expect(url.pathname).toBe("/auth/set-password");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      token_hash: "abc 123",
      type: "recovery",
      error: "Too short",
    });
  });

  it("carries only an error for a signed-in retry", () => {
    expect(setPasswordUrl({ error: "Too weak" })).toBe("/auth/set-password?error=Too+weak");
  });
});
