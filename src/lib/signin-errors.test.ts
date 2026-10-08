import { describe, expect, it } from "vitest";
import { SIGN_IN_ERROR_MESSAGES, signInErrorCode, signInErrorMessage } from "@/lib/signin-errors";

describe("signInErrorCode", () => {
  it.each([
    [{ code: "invalid_credentials" }, "invalid_credentials"],
    [{ code: "over_request_rate_limit" }, "rate_limited"],
    [{ code: "unexpected_failure" }, "sign_in_failed"],
    [{ code: null }, "sign_in_failed"],
    [{}, "sign_in_failed"],
    [null, "sign_in_failed"],
  ])("maps %o to %s", (error, expected) => {
    expect(signInErrorCode(error)).toBe(expected);
  });
});

describe("signInErrorMessage", () => {
  it.each([
    ["invalid_credentials", "Wrong email or password."],
    ["rate_limited", "Too many sign-in attempts. Wait a minute and try again."],
    ["not_configured", "Sign-in isn't configured on this server."],
    ["sign_in_failed", "Couldn't sign you in. Try again in a moment."],
  ])("maps %s to its fixed message", (code, expected) => {
    expect(signInErrorMessage(code)).toBe(expected);
  });

  it("has a message for every code", () => {
    expect(Object.keys(SIGN_IN_ERROR_MESSAGES).sort()).toEqual(
      ["invalid_credentials", "not_configured", "rate_limited", "sign_in_failed"].sort(),
    );
  });

  it.each([["Invalid login credentials"], ["<script>spoof</script>"], ["toString"], ["__proto__"], [""]])(
    "returns null for the unknown code %j",
    (code) => {
      expect(signInErrorMessage(code)).toBeNull();
    },
  );

  it("returns null without a code", () => {
    expect(signInErrorMessage(null)).toBeNull();
  });
});
