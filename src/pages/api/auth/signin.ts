import type { APIRoute } from "astro";
import { z } from "zod";
import { classifyAuthError, SIGN_IN_QUIET_CODES } from "@/lib/auth-errors";
import { reportHandledError } from "@/lib/report-handled-error";
import { createClient } from "@/lib/supabase";
import { signInErrorCode } from "@/lib/signin-errors";

export const prerender = false;

const signInSchema = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
});

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData().catch(() => null);
  const parsed = signInSchema.safeParse({
    email: form?.get("email") ?? undefined,
    password: form?.get("password") ?? undefined,
  });
  if (!parsed.success) {
    return context.redirect("/auth/signin?error=invalid_credentials");
  }
  const { email, password } = parsed.data;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect("/auth/signin?error=not_configured");
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // A wrong password is the user's own, so only a system fault is reported. The raw Supabase
    // message never reaches the URL, which only carries a fixed code.
    switch (classifyAuthError(error, SIGN_IN_QUIET_CODES)) {
      case "fault":
        reportHandledError("auth.signin", error);
        break;
      case "rate_limit":
        console.warn(`auth signin: rate limited (${error.code ?? error.status})`);
        break;
      case "quiet":
        console.info(`auth signin: rejected (${error.code})`);
    }
    return context.redirect(`/auth/signin?error=${signInErrorCode(error)}`);
  }

  return context.redirect("/dashboard");
};
