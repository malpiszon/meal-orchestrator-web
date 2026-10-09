import type { APIRoute } from "astro";
import { authLinkQuerySchema, authLinkRoute } from "@/lib/auth-link";

export const prerender = false;

/**
 * Forwards an invitation or password-reset link sent before emails linked straight to the
 * set-password page. The token is not used here; the set-password form's POST verifies it.
 */
export const GET: APIRoute = (context) => {
  const query = authLinkQuerySchema.safeParse(Object.fromEntries(context.url.searchParams));
  if (!query.success) {
    console.warn("auth confirm: invalid link query", query.error.issues);
    return context.redirect("/auth/signin?error=invalid_link");
  }

  return context.redirect(authLinkRoute(query.data));
};
