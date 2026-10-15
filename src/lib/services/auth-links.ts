import type { SupabaseClient } from "@supabase/supabase-js";
import { reportHandledError } from "@/lib/report-handled-error";
import { AUTH_LINK_LIFETIME_SECONDS, type SetPasswordLink } from "@/lib/set-password";

/** A stalled check gives up after this long and fails open, so the page never waits on it. */
export const AUTH_LINK_CHECK_TIMEOUT_MS = 2000;

/**
 * Whether an emailed set-password link (invitation or password reset) can still be used, asked
 * read-only through the `auth_link_is_valid` Postgres function, so the token is never used up.
 * Pass the service-role client (`createServiceClient`): a fresh link click has no session, and
 * only `service_role` may execute the function.
 *
 * Fails open: a missing client (service key or URL not configured), an RPC error, a timeout or a
 * thrown exception returns `true`, so the form still shows and the POST's real verification decides.
 * An RPC error, a timeout or a thrown exception is reported as a warning (`auth.link_check`), so a
 * check that always fails shows up; a missing client only logs, since `createServiceClient` already
 * reported the missing secret. Neither the logs nor the reports carry the token.
 */
export async function isSetPasswordLinkLive(supabase: SupabaseClient | null, link: SetPasswordLink): Promise<boolean> {
  if (!supabase) {
    console.warn(`auth link check skipped (type ${link.type}): service client not configured`);
    return true;
  }
  try {
    const result = await supabase
      .rpc("auth_link_is_valid", {
        p_token_hash: link.token_hash,
        p_type: link.type,
        p_lifetime_seconds: AUTH_LINK_LIFETIME_SECONDS,
      })
      .abortSignal(AbortSignal.timeout(AUTH_LINK_CHECK_TIMEOUT_MS));
    if (result.error) {
      // A timeout lands here too: the aborted fetch comes back as `result.error`.
      reportHandledError("auth.link_check", result.error, { level: "warning" });
      return true;
    }
    // The client is untyped (no generated database types); only an explicit `false` means dead.
    const live: unknown = result.data;
    if (live === false) {
      console.info(`auth link check: link not live (type ${link.type})`);
      return false;
    }
    return true;
  } catch (thrown) {
    reportHandledError("auth.link_check", thrown, { level: "warning" });
    return true;
  }
}
