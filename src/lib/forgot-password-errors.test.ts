import { describe, expect, it } from "vitest";
import { FORGOT_PASSWORD_ERROR_MESSAGES, forgotPasswordErrorMessage } from "@/lib/forgot-password-errors";

describe("forgotPasswordErrorMessage", () => {
  it.each([
    ["invalid_email", "Enter a valid email address"],
    ["not_configured", "Password reset isn't configured on this server."],
    ["invalid_link", "This link is invalid or has expired. Ask for a new one."],
  ])("maps %s to its fixed message", (code, expected) => {
    expect(forgotPasswordErrorMessage(code)).toBe(expected);
  });

  it("has a message for every code", () => {
    expect(Object.keys(FORGOT_PASSWORD_ERROR_MESSAGES).sort()).toEqual(
      ["invalid_email", "invalid_link", "not_configured"].sort(),
    );
  });

  it.each([["Enter a valid email address"], ["<script>spoof</script>"], ["toString"], ["__proto__"], [""]])(
    "returns null for the unknown code %j",
    (code) => {
      expect(forgotPasswordErrorMessage(code)).toBeNull();
    },
  );

  it("returns null without a code", () => {
    expect(forgotPasswordErrorMessage(null)).toBeNull();
  });
});
