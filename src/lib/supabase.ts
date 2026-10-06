import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AstroCookies } from "astro";
import { SUPABASE_URL, SUPABASE_KEY, SUPABASE_SERVICE_ROLE_KEY } from "astro:env/server";

export function createClient(requestHeaders: Headers, cookies: AstroCookies) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return null;
  }
  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return parseCookieHeader(requestHeaders.get("Cookie") ?? "");
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookies.set(name, value, options);
        });
      },
    },
  });
}

/**
 * Cookie-less service-role client for machine-to-machine writes (MO deliveries).
 * It bypasses RLS: never use it for reads or writes of user data in a user-facing code path.
 * The one exception is read-only RPCs executable only by `service_role`, such as the emailed-link
 * check on `/auth/set-password` (`auth_link_is_valid`): a fresh link click has no session to
 * call them with, and they return a yes/no, never user data.
 */
export function createServiceClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  return createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Cookie-less anon client for auth calls that must not touch the requester's cookies (the
 * password-reset request). Implicit flow, so the emailed link carries a token hash that
 * `verifyOtp({ token_hash, type })` accepts in any browser, with no PKCE code-verifier cookie.
 */
export function createStatelessClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return null;
  }
  return createSupabaseClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, flowType: "implicit" },
  });
}
