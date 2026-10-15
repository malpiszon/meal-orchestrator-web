import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isAuthRateLimit, isAuthSystemFault, SESSION_QUIET_CODES } from "@/lib/auth-errors";
import { reportHandledError } from "@/lib/report-handled-error";

/**
 * The signed-in user, or `null`. Every failure reads as signed out; `fault` is true when that was an
 * Auth system fault (reported under `step`) rather than a missing, expired or revoked session. A rate
 * limit only logs a warn line.
 */
export async function readSessionUser(
  supabase: SupabaseClient,
  step: string,
): Promise<{ user: User | null; fault: boolean }> {
  let result: Awaited<ReturnType<SupabaseClient["auth"]["getUser"]>>;
  try {
    result = await supabase.auth.getUser();
  } catch (error) {
    reportHandledError(step, error);
    return { user: null, fault: true };
  }

  const { error } = result;
  if (!error) return { user: result.data.user, fault: false };

  if (isAuthSystemFault(error, SESSION_QUIET_CODES)) {
    reportHandledError(step, error);
    return { user: null, fault: true };
  }
  if (isAuthRateLimit(error)) {
    console.warn(`auth session: rate limited (${error.code ?? error.status})`);
  }
  return { user: null, fault: false };
}
