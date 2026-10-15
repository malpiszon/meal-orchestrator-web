import { captureException } from "@sentry/cloudflare";
import { defineMiddleware } from "astro:middleware";
import { readSessionUser } from "@/lib/services/auth-session";
import { createClient } from "@/lib/supabase";

const PROTECTED_ROUTES = ["/dashboard", "/history"];

// Machine-to-machine routes (MO): bearer-token auth, no cookie session. Never add them to PROTECTED_ROUTES.
const MACHINE_ROUTE_PREFIX = "/api/mo/";

export const onRequest = defineMiddleware(async (context, next) => {
  // Astro turns a thrown page or route error into its own 500, so the Worker's Sentry wrapper never sees it.
  try {
    if (context.url.pathname.startsWith(MACHINE_ROUTE_PREFIX)) {
      context.locals.user = null;
      return await next();
    }

    const supabase = createClient(context.request.headers, context.cookies);

    // A session that couldn't be checked (an Auth outage, reported, or a rate limit) still reads as
    // signed out, but the redirect says so instead of looking like a sign-out.
    let sessionUnchecked = false;
    if (supabase) {
      const { user, failure } = await readSessionUser(supabase, "auth.session");
      context.locals.user = user;
      sessionUnchecked = failure !== null;
    } else {
      context.locals.user = null;
    }

    if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
      if (!context.locals.user) {
        return context.redirect(sessionUnchecked ? "/auth/signin?error=session_unavailable" : "/auth/signin");
      }
    }

    return await next();
  } catch (error) {
    // Unhandled, like the Worker's own captures: Astro only turns it into a 500 page.
    captureException(error, { mechanism: { handled: false, type: "auto.middleware.astro" } });
    throw error;
  }
});
