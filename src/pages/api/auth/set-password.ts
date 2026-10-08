import type { APIRoute } from "astro";
import {
  FORGOT_PASSWORD_PATH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_RETRY_COOKIE,
  PASSWORD_RETRY_MAX_AGE_SECONDS,
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
 * If saving fails after the token was used, the user keeps the session it created and, for a
 * short while (`PASSWORD_RETRY_COOKIE`), can retry from the page without a token.
 */
export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect("/auth/signin?error=not_configured");
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
        error:
          parsed.error.issues.find((issue) => issue.path[0] === "password")?.message ??
          `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      }),
    );
  }
  const { password, token_hash, type } = parsed.data;

  // Set when this request used the emailed token, so a rejected password can be retried without it.
  let verifiedUserId: string | undefined;
  if (token_hash !== undefined && type !== undefined) {
    // 2. Verify the emailed token; on success the cookie-bound client holds the user's session.
    const { data, error } = await supabase.auth.verifyOtp({ token_hash, type });
    if (error) {
      console.error(`auth set-password: verifyOtp failed (${type}): ${error.message}`);
      return invalidLink();
    }
    verifiedUserId = data.user?.id;
  } else {
    // 3. No token: only the user whose save was just rejected may retry, not any signed-in session.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || context.cookies.get(PASSWORD_RETRY_COOKIE)?.value !== user.id) {
      return invalidLink();
    }
  }

  // 4. Save the password. On failure the session remains, so the retry needs no token.
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error(`auth set-password: updateUser failed: ${error.code ?? error.status} ${error.message}`);
    if (verifiedUserId) {
      context.cookies.set(PASSWORD_RETRY_COOKIE, verifiedUserId, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: context.url.protocol === "https:",
        maxAge: PASSWORD_RETRY_MAX_AGE_SECONDS,
      });
    }
    return context.redirect(setPasswordUrl({ error: passwordErrorMessage(error) }));
  }

  context.cookies.delete(PASSWORD_RETRY_COOKIE, { path: "/" });
  return context.redirect("/dashboard");
};
