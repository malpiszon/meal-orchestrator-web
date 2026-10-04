import type { APIRoute } from "astro";
import { FORGOT_PASSWORD_PATH, passwordErrorMessage, resetRequestSchema } from "@/lib/set-password";
import { createStatelessClient } from "@/lib/supabase";

export const prerender = false;

/**
 * Asks Supabase to email a set-a-new-password link. Answers the same for known and unknown
 * emails, so the form never reveals which accounts exist.
 */
export const POST: APIRoute = async (context) => {
  const backWithError = (message: string) =>
    context.redirect(`${FORGOT_PASSWORD_PATH}?error=${encodeURIComponent(message)}`);

  const form = await context.request.formData();
  const parsed = resetRequestSchema.safeParse({ email: form.get("email") ?? undefined });
  if (!parsed.success) {
    return backWithError("Enter a valid email address");
  }

  // Cookie-less client: the reset is often finished in another browser, so no PKCE verifier cookie.
  const supabase = createStatelessClient();
  if (!supabase) {
    return backWithError("Supabase is not configured");
  }

  // No redirectTo: the recovery template builds the link from {{ .SiteURL }}.
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email);
  if (error) {
    console.error(`auth forgot-password: resetPasswordForEmail failed: ${error.code ?? error.status} ${error.message}`);
    return backWithError(passwordErrorMessage(error));
  }

  return context.redirect(`${FORGOT_PASSWORD_PATH}?sent=1`);
};
