import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isSetPasswordLinkLive } from "@/lib/services/auth-links";
import { AUTH_LINK_LIFETIME_SECONDS, type SetPasswordLink } from "@/lib/set-password";

const TOKEN = "secret-token-hash";
const link: SetPasswordLink = { token_hash: TOKEN, type: "recovery" };

function clientReturning(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { rpc, supabase: { rpc } as unknown as SupabaseClient };
}

function warnedText(warn: { mock: { calls: unknown[][] } }): string {
  return warn.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
}

describe("isSetPasswordLinkLive", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true when the database says the link is valid", async () => {
    const { supabase } = clientReturning({ data: true, error: null });
    await expect(isSetPasswordLinkLive(supabase, link)).resolves.toBe(true);
  });

  it("returns false when the database says the link is used or expired", async () => {
    const { supabase } = clientReturning({ data: false, error: null });
    await expect(isSetPasswordLinkLive(supabase, link)).resolves.toBe(false);
  });

  it("fails open on an RPC error and warns without the token", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { supabase } = clientReturning({ data: null, error: { code: "42883", message: "function does not exist" } });

    await expect(isSetPasswordLinkLive(supabase, link)).resolves.toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    const text = warnedText(warn);
    expect(text).toContain("42883");
    expect(text).toContain("recovery");
    expect(text).not.toContain(TOKEN);
  });

  it("fails open when the RPC throws, without logging the token", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const rpc = vi.fn(() => Promise.reject(new Error("fetch failed")));
    const supabase = { rpc } as unknown as SupabaseClient;

    await expect(isSetPasswordLinkLive(supabase, link)).resolves.toBe(true);
    expect(warnedText(warn)).not.toContain(TOKEN);
  });

  it("fails open without a client and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(isSetPasswordLinkLive(null, { token_hash: TOKEN, type: "invite" })).resolves.toBe(true);
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
});
