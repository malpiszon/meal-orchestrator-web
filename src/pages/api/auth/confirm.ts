import type { APIRoute } from "astro";
import { authLinkQuerySchema, authLinkRoute } from "@/lib/auth-link";
import { createClient } from "@/lib/supabase";

export const prerender = false;

const INVALID_LINK_MESSAGE = "This link is invalid or has expired. Ask for a new one.";

/**
 * Handles an invitation or password-reset email link. Reset links are forwarded to the
 * set-password page without using their token; invitations are verified here and sign the user in.
 */
export const GET: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const invalidLink = () => context.redirect(`/auth/signin?error=${encodeURIComponent(INVALID_LINK_MESSAGE)}`);

  const query = authLinkQuerySchema.safeParse(Object.fromEntries(context.url.searchParams));
  if (!query.success) {
    console.warn("auth confirm: invalid link query", query.error.issues);
    return invalidLink();
  }

  const route = authLinkRoute(query.data);
  if (route.verify) {
    const { error } = await supabase.auth.verifyOtp(query.data);
    if (error) {
      console.error(`auth confirm: verifyOtp failed (${query.data.type}): ${error.message}`);
      return invalidLink();
    }
  }

  return context.redirect(route.location);
};
