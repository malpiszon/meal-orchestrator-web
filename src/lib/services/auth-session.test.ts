import { captureException } from "@sentry/cloudflare";
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { readSessionUser } from "@/lib/services/auth-session";

vi.mock("@sentry/cloudflare", () => ({ captureException: vi.fn() }));

const USER = { id: "user-1" } as User;

function fakeClient(getUser: () => Promise<unknown>): SupabaseClient {
  return { auth: { getUser } } as unknown as SupabaseClient;
}

function failingWith(error: Error): SupabaseClient {
  return fakeClient(() => Promise.resolve({ data: { user: null }, error }));
}

describe("readSessionUser", () => {
  let error: MockInstance<typeof console.error>;
  let warn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.mocked(captureException).mockReset();
    vi.restoreAllMocks();
  });

  it("returns the user", async () => {
    const supabase = fakeClient(() => Promise.resolve({ data: { user: USER }, error: null }));

    await expect(readSessionUser(supabase, "auth.session")).resolves.toEqual({
      user: USER,
      failure: null,
    });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("reads a missing session as signed out, with no log or report", async () => {
    await expect(readSessionUser(failingWith(new AuthSessionMissingError()), "auth.session")).resolves.toEqual({
      user: null,
      failure: null,
    });
    expect(captureException).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["bad_jwt", "no_authorization"])("reads %s as signed out with a warn line, no report", async (code) => {
    const failure = new AuthApiError("refused", 403, code);

    await expect(readSessionUser(failingWith(failure), "auth.session")).resolves.toEqual({
      user: null,
      failure: null,
    });
    expect(captureException).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(`auth session: signed out by ${code}`);
  });

  it("reads a failed refresh as signed out, with no log or report", async () => {
    const failure = new AuthApiError("Invalid Refresh Token: Refresh Token Not Found", 400, "refresh_token_not_found");

    await expect(readSessionUser(failingWith(failure), "auth.session")).resolves.toEqual({
      user: null,
      failure: null,
    });
    expect(captureException).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("reports a 503 under the step and flags the fault", async () => {
    const failure = new AuthRetryableFetchError("Service Unavailable", 503);

    await expect(readSessionUser(failingWith(failure), "auth.session")).resolves.toEqual({
      user: null,
      failure: "fault",
    });
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({
        fingerprint: ["handled", "auth.session", "http_503"],
        tags: { step: "auth.session", error_code: "http_503" },
      }),
    );
  });

  it("logs a rate limit at warn, with no report", async () => {
    const failure = new AuthApiError("Request rate limit reached", 429, "over_request_rate_limit");

    await expect(readSessionUser(failingWith(failure), "auth.session")).resolves.toEqual({
      user: null,
      failure: "rate_limit",
    });
    expect(warn).toHaveBeenCalledWith("auth session: rate limited (over_request_rate_limit)");
    expect(captureException).not.toHaveBeenCalled();
  });

  it("reports an exception thrown by the client and flags the fault", async () => {
    const failure = new Error("boom");
    const supabase = fakeClient(() => Promise.reject(failure));

    await expect(readSessionUser(supabase, "auth.session")).resolves.toEqual({
      user: null,
      failure: "fault",
    });
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ fingerprint: ["handled", "auth.session", "unknown"] }),
    );
  });
});
