import { captureException } from "@sentry/cloudflare";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_LINK_CHECK_TIMEOUT_MS, isSetPasswordLinkLive } from "@/lib/services/auth-links";
import { AUTH_LINK_LIFETIME_SECONDS, type SetPasswordLink } from "@/lib/set-password";

vi.mock("@sentry/cloudflare", () => ({ captureException: vi.fn() }));

const TOKEN = "secret-token-hash";
const link: SetPasswordLink = { token_hash: TOKEN, type: "recovery" };

function clientReturning(result: { data: unknown; error: unknown }) {
  const abortSignal = vi.fn((_signal: AbortSignal) => Promise.resolve(result));
  const rpc = vi.fn(() => ({ abortSignal }));
  return { rpc, abortSignal, supabase: { rpc } as unknown as SupabaseClient };
}

function warnedText(warn: { mock: { calls: unknown[][] } }): string {
  return warn.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
}

/** Everything handed to Sentry, the error's message and cause included, as text. */
function capturedText(): string {
  return JSON.stringify(
    vi
      .mocked(captureException)
      .mock.calls.map(([error, hint]) => [
        error instanceof Error ? { message: error.message, cause: error.cause } : error,
        hint,
      ]),
  );
}

/** Exactly one Sentry capture, at warning level under the link check's step, grouped by `code`. */
function expectOneLinkCheckWarning(code: string): void {
  expect(captureException).toHaveBeenCalledTimes(1);
  expect(vi.mocked(captureException).mock.calls[0]?.[1]).toMatchObject({
    level: "warning",
    fingerprint: ["handled", "auth.link_check", code],
    tags: { step: "auth.link_check", error_code: code },
  });
}

describe("isSetPasswordLinkLive", () => {
  afterEach(() => {
    vi.mocked(captureException).mockReset();
    vi.restoreAllMocks();
  });

  it("returns true when the database says the link is valid, with no report", async () => {
    const { supabase } = clientReturning({ data: true, error: null });
    await expect(isSetPasswordLinkLive(supabase, link)).resolves.toBe(true);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("returns false when the database says the link is used or expired, and logs it without the token", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { supabase } = clientReturning({ data: false, error: null });

    await expect(isSetPasswordLinkLive(supabase, link)).resolves.toBe(false);
    expect(captureException).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
    const text = warnedText(info);
    expect(text).toContain("link not live");
    expect(text).toContain("recovery");
    expect(text).not.toContain(TOKEN);
  });

  it("fails open on an RPC error and reports it as a warning without the token", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { supabase } = clientReturning({ data: null, error: { code: "42883", message: "function does not exist" } });

    await expect(isSetPasswordLinkLive(supabase, link)).resolves.toBe(true);
    expectOneLinkCheckWarning("42883");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warnedText(warn)).toContain("42883");
    expect(warnedText(warn)).not.toContain(TOKEN);
    expect(capturedText()).not.toContain(TOKEN);
  });

  it("fails open when the RPC throws, and reports it as a warning without the token", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const rpc = vi.fn(() => ({ abortSignal: () => Promise.reject(new Error("fetch failed")) }));
    const supabase = { rpc } as unknown as SupabaseClient;

    await expect(isSetPasswordLinkLive(supabase, link)).resolves.toBe(true);
    expectOneLinkCheckWarning("unknown");
    expect(warnedText(warn)).toContain("fetch failed");
    expect(warnedText(warn)).not.toContain(TOKEN);
    expect(capturedText()).not.toContain(TOKEN);
  });

  it("fails open without a client and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(isSetPasswordLinkLive(null, { token_hash: TOKEN, type: "invite" })).resolves.toBe(true);
    expect(captureException).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const text = warnedText(warn);
    expect(text).toContain("invite");
    expect(text).not.toContain(TOKEN);
  });

  it("passes the token, type and link lifetime to auth_link_is_valid", async () => {
    const { rpc, supabase } = clientReturning({ data: true, error: null });

    await isSetPasswordLinkLive(supabase, link);
    expect(rpc).toHaveBeenCalledWith("auth_link_is_valid", {
      p_token_hash: TOKEN,
      p_type: "recovery",
      p_lifetime_seconds: AUTH_LINK_LIFETIME_SECONDS,
    });
  });

  it("bounds the check with a timeout signal", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const { abortSignal, supabase } = clientReturning({ data: true, error: null });

    await isSetPasswordLinkLive(supabase, link);
    expect(timeout).toHaveBeenCalledWith(AUTH_LINK_CHECK_TIMEOUT_MS);
    expect(abortSignal).toHaveBeenCalledWith(timeout.mock.results[0]?.value);
  });
});
