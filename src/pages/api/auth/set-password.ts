import type { APIRoute } from "astro";
import {
  FORGOT_PASSWORD_PATH,
  MIN_PASSWORD_LENGTH,
  passwordErrorMessage,
  setPasswordFormSchema,
  setPasswordLinkSchema,
  setPasswordUrl,
} from "@/lib/set-password";
import { createClient } from "@/lib/supabase";

export const prerender = false;

const INVALID_LINK_MESSAGE = "This link is invalid or has expired. Ask for a new one.";

/**
 * Saves a new password from the set-password page. The emailed token is verified only here, on
 * the POST, and only after the password passed validation, so a rejected password never uses it.
 * If saving fails after the token was used, the user keeps the session it created and can retry
 * from the page without a token.
 */
export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const invalidLink = () =>
    context.redirect(`${FORGOT_PASSWORD_PATH}?error=${encodeURIComponent(INVALID_LINK_MESSAGE)}`);

  const form = await context.request.formData().catch(() => null);
  const field = (name: string) => {
    const value = form?.get(name);
    return typeof value === "string" ? value : undefined;
  };
  const raw = { password: field("password"), token_hash: field("token_hash"), type: field("type") };

  // 1. Validate before touching the token: once verified, it is gone.
  const parsed = setPasswordFormSchema.safeParse(raw);
  if (!parsed.success) {
    const hasLink = raw.token_hash !== undefined || raw.type !== undefined;
    const link = setPasswordLinkSchema.safeParse({ token_hash: raw.token_hash, type: raw.type });
    if (hasLink && !link.success) {
      console.warn("auth set-password: invalid link fields", link.error.issues);
      return invalidLink();
    }
    return context.redirect(
      setPasswordUrl({
        link: link.success ? link.data : undefined,
        error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      }),
    );
  }
  const { password, token_hash, type } = parsed.data;

  if (token_hash !== undefined && type !== undefined) {
    // 2. Verify the emailed token; on success the cookie-bound client holds the user's session.
    const { error } = await supabase.auth.verifyOtp({ token_hash, type });
    if (error) {
      console.error(`auth set-password: verifyOtp failed (${type}): ${error.message}`);
      return invalidLink();
    }
  } else {
    // 3. No token: only a signed-in user retrying after a rejected password may continue.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return invalidLink();
    }
  }

  // 4. Save the password. On failure the session remains, so the retry needs no token.
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error(`auth set-password: updateUser failed: ${error.code ?? error.status} ${error.message}`);
    return context.redirect(setPasswordUrl({ error: passwordErrorMessage(error) }));
  }

  return context.redirect("/dashboard");
};
