import { describe, expect, it } from "vitest";
import { isAuthRejection, isGoTrueKeyRejection } from "@/lib/mo-delivery-faults";

describe("isAuthRejection", () => {
  it.each([401, 403])("treats status %i as an auth rejection", (status) => {
    expect(isAuthRejection({ status, code: "bad_jwt", message: "invalid JWT" })).toBe(true);
  });

  it.each(["PGRST301", "PGRST302"])("treats the PostgREST JWT error %s as an auth rejection", (code) => {
    expect(isAuthRejection({ code, message: "JWT rejected" })).toBe(true);
  });

  it.each([400, 404, 500])("treats status %i as not an auth rejection", (status) => {
    expect(isAuthRejection({ status, message: "failed" })).toBe(false);
  });

  it.each([
    ["P0002", "unknown_user"],
    ["22P05", "unsupported Unicode escape sequence"],
    ["55000", "week_started"],
    ["XX000", "storage"],
  ])("treats the Postgres code %s (%s) as not an auth rejection", (code, message) => {
    expect(isAuthRejection({ code, message })).toBe(false);
  });

  it("treats an error with no status and no code as not an auth rejection", () => {
    expect(isAuthRejection({ status: undefined, message: "storage" })).toBe(false);
  });

  it.each([[null], [undefined]])("treats %o as not an auth rejection", (error) => {
    expect(isAuthRejection(error)).toBe(false);
  });
});

describe("isGoTrueKeyRejection", () => {
  it("treats a 401 without a code as a key rejection", () => {
    expect(isGoTrueKeyRejection({ status: 401, message: "Unauthorized" })).toBe(true);
  });

  it.each(["bad_jwt", "not_admin", "no_authorization"])("treats a 403 with %s as a key rejection", (code) => {
    expect(isGoTrueKeyRejection({ status: 403, code, message: "forbidden" })).toBe(true);
  });

  it.each([["email_address_not_authorized"], [undefined]])(
    "treats a 403 with code %s as not a key rejection",
    (code) => {
      expect(isGoTrueKeyRejection({ status: 403, code, message: "forbidden" })).toBe(false);
    },
  );

  it.each([
    [{ status: 500, code: "unexpected_failure", message: "Error sending invite email" }],
    [{ status: 429, code: "over_email_send_rate_limit", message: "rate limit" }],
    [null],
  ])("treats %o as not a key rejection", (error) => {
    expect(isGoTrueKeyRejection(error)).toBe(false);
  });
});
