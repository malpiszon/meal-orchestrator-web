import {
  AuthApiError,
  AuthError,
  AuthRefreshDiscardedError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
} from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  isAuthRateLimit,
  isAuthSystemFault,
  RESET_EMAIL_QUIET_CODES,
  SESSION_QUIET_CODES,
  SIGN_IN_QUIET_CODES,
  VERIFY_OTP_QUIET_CODES,
} from "@/lib/auth-errors";

const RATE_LIMIT_CODES = ["over_request_rate_limit", "over_email_send_rate_limit", "over_sms_send_rate_limit"];

const SITES = [
  ["session", SESSION_QUIET_CODES],
  ["verify", VERIFY_OTP_QUIET_CODES],
  ["sign-in", SIGN_IN_QUIET_CODES],
  ["reset email", RESET_EMAIL_QUIET_CODES],
] as const;

describe("isAuthSystemFault", () => {
  describe.each(SITES)("at %s", (_site, quietCodes) => {
    it.each([...quietCodes])("treats the quiet code %s as normal", (code) => {
      expect(isAuthSystemFault(new AuthApiError("rejected", 400, code), quietCodes)).toBe(false);
    });

    it("treats a missing session as normal", () => {
      expect(isAuthSystemFault(new AuthSessionMissingError(), quietCodes)).toBe(false);
    });

    it("treats a refresh discarded by a concurrent sign-out as normal", () => {
      expect(isAuthSystemFault(new AuthRefreshDiscardedError(), quietCodes)).toBe(false);
    });

    it.each(RATE_LIMIT_CODES)("treats a 429 %s as normal", (code) => {
      expect(isAuthSystemFault(new AuthApiError("slow down", 429, code), quietCodes)).toBe(false);
    });

    it.each([0, 503])("treats a retryable fetch error with status %i as a fault", (status) => {
      expect(isAuthSystemFault(new AuthRetryableFetchError("unavailable", status), quietCodes)).toBe(true);
    });

    it("treats a non-JSON response as a fault", () => {
      expect(isAuthSystemFault(new AuthUnknownError("Unexpected token <", new SyntaxError("bad")), quietCodes)).toBe(
        true,
      );
    });

    it("treats an API error with no code as a fault", () => {
      expect(isAuthSystemFault(new AuthApiError("odd", 400, undefined), quietCodes)).toBe(true);
    });

    it("treats an unexpected code as a fault", () => {
      expect(isAuthSystemFault(new AuthApiError("boom", 400, "unexpected_failure"), quietCodes)).toBe(true);
    });

    it.each([[new Error("boom")], ["boom"], [null]])("treats the non-AuthError %o as a fault", (error) => {
      expect(isAuthSystemFault(error, quietCodes)).toBe(true);
    });
  });

  it("treats validation_failed at verify as a fault (an unsupported link type is our bug)", () => {
    expect(isAuthSystemFault(new AuthApiError("invalid type", 400, "validation_failed"), VERIFY_OTP_QUIET_CODES)).toBe(
      true,
    );
  });

  it("treats a 429 with no code as a rate limit, not a fault", () => {
    expect(isAuthSystemFault(new AuthApiError("slow down", 429, undefined), SESSION_QUIET_CODES)).toBe(false);
  });

  it("treats an Auth error with no status as a fault, even with a quiet code", () => {
    expect(isAuthSystemFault(new AuthError("odd", undefined, "otp_expired"), VERIFY_OTP_QUIET_CODES)).toBe(true);
  });

  it("treats a quiet code as a fault when it comes with a 5xx", () => {
    expect(isAuthSystemFault(new AuthApiError("boom", 500, "otp_expired"), VERIFY_OTP_QUIET_CODES)).toBe(true);
  });

  it("treats a code that is quiet elsewhere as a fault at a site that doesn't expect it", () => {
    expect(isAuthSystemFault(new AuthApiError("expired", 403, "otp_expired"), SIGN_IN_QUIET_CODES)).toBe(true);
  });
});

describe("isAuthRateLimit", () => {
  it.each(RATE_LIMIT_CODES)("is true for %s", (code) => {
    expect(isAuthRateLimit(new AuthApiError("slow down", 429, code))).toBe(true);
  });

  it("is true for a 429 with no code", () => {
    expect(isAuthRateLimit(new AuthApiError("slow down", 429, undefined))).toBe(true);
  });

  it("is false for other Auth errors", () => {
    expect(isAuthRateLimit(new AuthApiError("rejected", 400, "invalid_credentials"))).toBe(false);
    expect(isAuthRateLimit(new AuthRetryableFetchError("unavailable", 503))).toBe(false);
  });

  it("is false for a non-AuthError", () => {
    expect(isAuthRateLimit(Object.assign(new Error("slow down"), { status: 429 }))).toBe(false);
  });
});
